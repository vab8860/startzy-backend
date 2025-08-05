const express = require('express');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const router = express.Router();

const db = admin.firestore();

// Instagram API configuration
const FACEBOOK_APP_ID = "2681931078822638";
const INSTAGRAM_APP_SECRET = "96308c518f0d78da4506d1258e19607c";
const REDIRECT_URI = "https://startzy-afd83.web.app";

// Exchange authorization code for short-lived token
const exchangeCodeForShortLivedToken = async (code) => {
  const url = new URL("https://graph.facebook.com/v18.0/oauth/access_token");
  url.searchParams.append("client_id", FACEBOOK_APP_ID);
  url.searchParams.append("client_secret", INSTAGRAM_APP_SECRET);
  url.searchParams.append("redirect_uri", REDIRECT_URI);
  url.searchParams.append("code", code);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${data.error?.message || "Unknown error"}`);
  }

  return data.access_token;
};

// Exchange short-lived token for long-lived token
const exchangeForLongLivedToken = async (shortLivedToken) => {
  const url = new URL("https://graph.facebook.com/v18.0/oauth/access_token");
  url.searchParams.append("grant_type", "fb_exchange_token");
  url.searchParams.append("client_id", FACEBOOK_APP_ID);
  url.searchParams.append("client_secret", INSTAGRAM_APP_SECRET);
  url.searchParams.append("fb_exchange_token", shortLivedToken);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Long-lived token exchange failed: ${data.error?.message || "Unknown error"}`);
  }

  return data.access_token;
};

// Get Facebook Pages connected to this user
const getFacebookPages = async (accessToken) => {
  const url = new URL("https://graph.facebook.com/v18.0/me/accounts");
  url.searchParams.append("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Failed to get Facebook pages: ${data.error?.message || "Unknown error"}`);
  }

  return data.data || [];
};

// Get Instagram Business Account from Facebook Page
const getInstagramBusinessAccount = async (pageId, pageAccessToken) => {
  const url = new URL(`https://graph.facebook.com/v18.0/${pageId}`);
  url.searchParams.append("fields", "instagram_business_account");
  url.searchParams.append("access_token", pageAccessToken);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Failed to get Instagram account: ${data.error?.message || "Unknown error"}`);
  }

  return data.instagram_business_account?.id || null;
};

// Fetch Instagram profile data
const fetchInstagramProfileData = async (igUserId, accessToken) => {
  const url = new URL(`https://graph.facebook.com/v18.0/${igUserId}`);
  url.searchParams.append("fields", "username,followers_count,media_count,profile_picture_url");
  url.searchParams.append("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Failed to fetch Instagram profile: ${data.error?.message || "Unknown error"}`);
  }

  return data;
};

// Store Instagram data in Firestore
const storeInstagramData = async (uid, profileData, longLivedToken) => {
  const instagramData = {
    igUserId: profileData.id,
    username: profileData.username,
    followers_count: profileData.followers_count,
    media_count: profileData.media_count,
    profile_picture_url: profileData.profile_picture_url,
    lastSyncedAt: admin.firestore.Timestamp.now(),
    longLivedToken: longLivedToken,
    connected_at: admin.firestore.Timestamp.now(),
  };

  await db.collection("users").doc(uid).update({
    instagramProfile: instagramData,
    instagramConnectedAt: admin.firestore.Timestamp.now(),
  });
};

// Instagram OAuth auth URL generation endpoint
router.get('/auth-url', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        error: "Missing userId parameter"
      });
    }
    
    const scopes = "instagram_basic,pages_show_list,pages_read_engagement";
    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scopes)}&response_type=code&state=${userId}`;
    
    res.json({ authUrl });
  } catch (error) {
    console.error("Error generating Instagram auth URL:", error);
    res.status(500).json({
      error: "Failed to generate auth URL",
      details: error.message
    });
  }
});

// Instagram OAuth callback endpoint
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    console.log('Instagram OAuth callback received:', { 
      hasCode: !!code, 
      hasState: !!state, 
      error 
    });

    // Check for OAuth error
    if (error) {
      console.error("Instagram OAuth error:", error);
      return res.status(400).json({
        error: "Instagram OAuth failed",
        details: error
      });
    }

    // Validate required parameters
    if (!code || !state) {
      console.error("Missing required parameters:", { code: !!code, state: !!state });
      return res.status(400).json({
        error: "Missing required parameters",
        details: "Code and state are required"
      });
    }

    const uid = state;
    const authCode = code;

    console.log("Processing Instagram OAuth for user:", uid);

    // Step 1: Exchange code for short-lived token
    const shortLivedToken = await exchangeCodeForShortLivedToken(authCode);

    // Step 2: Exchange for long-lived token
    const longLivedToken = await exchangeForLongLivedToken(shortLivedToken);

    // Step 3: Get Facebook Pages connected to this user
    const pages = await getFacebookPages(longLivedToken);

    // Step 4: Find Instagram Business Account from pages
    let igUserId = "";
    let pageAccessToken = "";

    for (const page of pages) {
      try {
        const igAccount = await getInstagramBusinessAccount(page.id, page.access_token);
        if (igAccount) {
          igUserId = igAccount;
          pageAccessToken = page.access_token;
          break;
        }
      } catch (error) {
        // Continue to next page if this one doesn't have Instagram
        console.log("Page doesn't have Instagram business account:", page.id);
        continue;
      }
    }

    if (!igUserId) {
      console.error("No Instagram Business Account found");
      return res.status(400).json({
        error: "No Instagram Business Account found",
        details: "Please connect an Instagram Business or Creator account to your Facebook page."
      });
    }

    // Step 5: Fetch Instagram profile data
    const profileData = await fetchInstagramProfileData(igUserId, pageAccessToken);

    // Step 6: Store data in Firestore
    await storeInstagramData(uid, profileData, longLivedToken);

    console.log("Instagram OAuth completed successfully:", {
      uid,
      username: profileData.username,
      followers: profileData.followers_count
    });

    // Return success response
    res.status(200).json({
      success: true,
      data: {
        username: profileData.username,
        followers_count: profileData.followers_count,
        media_count: profileData.media_count,
        profile_picture_url: profileData.profile_picture_url,
      }
    });

  } catch (error) {
    console.error("Instagram OAuth callback failed:", error);
    res.status(500).json({
      error: "Instagram connection failed",
      details: error.message
    });
  }
});

module.exports = router;
