const express = require('express');
const admin = require('firebase-admin');
// Use built-in fetch in Node.js 18+
const fetch = globalThis.fetch || require('node-fetch');
const router = express.Router();

const db = admin.firestore();

// Google OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_OAUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REDIRECT_URI = process.env.YOUTUBE_REDIRECT_URI || "https://startzy.onrender.com/auth/youtube/callback";

// YouTube OAuth scopes
const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly'
].join(' ');

// Generate YouTube OAuth URL
router.get('/auth-url', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ 
        error: "User ID is required" 
      });
    }

    const authUrl = `${GOOGLE_OAUTH_URL}?` + new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: YOUTUBE_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state: userId // Pass user ID as state
    }).toString();

    res.json({ authUrl });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({
      error: 'Failed to generate auth URL',
      details: error.message
    });
  }
});

// YouTube OAuth callback handler
router.get('/callback', async (req, res) => {
  try {
    const { code, state: userId, error } = req.query;
    
    if (error) {
      console.error('OAuth error:', error);
      return res.redirect(`https://startzy-afd83.web.app/profile?error=oauth_failed`);
    }

    if (!code || !userId) {
      return res.redirect(`https://startzy-afd83.web.app/profile?error=missing_code`);
    }

    // Exchange authorization code for tokens
    const tokenParams = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI
    });

    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString()
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('Token exchange failed:', errorData);
      return res.redirect(`https://startzy-afd83.web.app/profile?error=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json();
    const { access_token, refresh_token, expires_in } = tokenData;

    if (!access_token || !refresh_token) {
      console.error('Missing tokens in response:', tokenData);
      return res.redirect(`https://startzy-afd83.web.app/profile?error=incomplete_tokens`);
    }

    // Fetch YouTube channel data
    const channelData = await fetchYouTubeChannelData(access_token);
    
    if (!channelData) {
      return res.redirect(`https://startzy-afd83.web.app/profile?error=channel_fetch_failed`);
    }

    // Store tokens and channel data in Firestore
    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + (expires_in || 3600) * 1000)
    );

    const youtubeTokens = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt,
      tokenType: 'Bearer'
    };

    await db.collection('users').doc(userId).update({
      youtubeTokens,
      youtubeChannel: channelData,
      youtubeConnectedAt: admin.firestore.Timestamp.now(),
      youtubeLastValidated: admin.firestore.Timestamp.now()
    });

    console.log('YouTube connection successful for user:', userId);
    res.redirect(`https://startzy-afd83.web.app/profile?success=youtube_connected`);

  } catch (error) {
    console.error('YouTube callback error:', error);
    res.redirect(`https://startzy-afd83.web.app/profile?error=callback_failed`);
  }
});

// Helper function to fetch YouTube channel data
async function fetchYouTubeChannelData(accessToken) {
  try {
    const channelResponse = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&mine=true',
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    if (!channelResponse.ok) {
      console.error('YouTube API error:', channelResponse.status);
      return null;
    }

    const channelData = await channelResponse.json();
    
    if (!channelData.items || channelData.items.length === 0) {
      console.error('No YouTube channel found');
      return null;
    }

    const channel = channelData.items[0];
    
    return {
      channelId: channel.id,
      channelTitle: channel.snippet.title,
      subscriberCount: parseInt(channel.statistics.subscriberCount || '0'),
      totalViews: parseInt(channel.statistics.viewCount || '0'),
      totalVideos: parseInt(channel.statistics.videoCount || '0'),
      thumbnailUrl: channel.snippet.thumbnails?.default?.url,
      lastSyncedAt: admin.firestore.Timestamp.now()
    };
  } catch (error) {
    console.error('Error fetching YouTube channel data:', error);
    return null;
  }
}

// Get YouTube connection status with fallback to cached data
router.get('/connection-status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ 
        error: "User ID is required" 
      });
    }

    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ 
        error: "User not found" 
      });
    }

    const userData = userDoc.data();
    const youtubeTokens = userData.youtubeTokens;
    const youtubeChannel = userData.youtubeChannel;

    // If no tokens exist, user needs to connect
    if (!youtubeTokens?.accessToken) {
      return res.json({ 
        isConnected: false, 
        error: "No YouTube connection found",
        needsReconnect: true
      });
    }

    // Check if token has expired
    const now = new Date();
    const tokenExpired = youtubeTokens.expiresAt && youtubeTokens.expiresAt.toDate() < now;

    if (tokenExpired && youtubeTokens.refreshToken) {
      // Try to refresh the token
      try {
        const refreshResult = await refreshTokenInternal(userId, youtubeTokens.refreshToken);
        return res.json({ 
          isConnected: true, 
          channelData: youtubeChannel,
          tokenRefreshed: true
        });
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);
        // Fall back to cached data if available
        if (youtubeChannel && youtubeChannel.channelTitle) {
          return res.json({ 
            isConnected: true, 
            channelData: youtubeChannel,
            warning: "Using cached data - token refresh failed",
            needsReconnect: true
          });
        }
        return res.json({ 
          isConnected: false, 
          error: "Token expired and refresh failed",
          needsReconnect: true
        });
      }
    }

    // Token is still valid or we have cached data
    if (youtubeChannel && youtubeChannel.channelTitle) {
      return res.json({ 
        isConnected: true, 
        channelData: youtubeChannel
      });
    }

    return res.json({ 
      isConnected: false, 
      error: "No channel data available",
      needsReconnect: true
    });

  } catch (error) {
    console.error('Error checking YouTube connection status:', error);
    res.status(500).json({
      error: 'Failed to check connection status',
      details: error.message
    });
  }
});

// Internal function to refresh token
async function refreshTokenInternal(userId, refreshToken) {
  const params = new URLSearchParams();
  params.append("client_id", GOOGLE_CLIENT_ID);
  params.append("client_secret", GOOGLE_CLIENT_SECRET);
  params.append("refresh_token", refreshToken);
  params.append("grant_type", "refresh_token");

  const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!tokenResp.ok) {
    const errorData = await tokenResp.json();
    throw new Error(`Token refresh failed: ${errorData.error_description || errorData.error}`);
  }

  const tokenData = await tokenResp.json();
  const { access_token, expires_in, refresh_token: newRefreshToken } = tokenData;
  
  if (!access_token) {
    throw new Error("No access token returned from Google");
  }

  // Update Firestore with new tokens
  const expiresAt = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + (expires_in || 3600) * 1000)
  );
  
  const updatedTokens = {
    accessToken: access_token,
    expiresAt,
    refreshToken: newRefreshToken || refreshToken,
    tokenType: 'Bearer'
  };

  await db.collection("users").doc(userId).update({ 
    youtubeTokens: updatedTokens,
    youtubeLastValidated: admin.firestore.Timestamp.now()
  });

  return { accessToken: access_token, expiresAt, refreshToken: newRefreshToken || refreshToken };
}

// Refresh YouTube access token using refresh token (legacy endpoint)
router.post('/refresh-token', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ 
        error: "User ID is required" 
      });
    }

    console.log('Refreshing YouTube token for user:', userId);

    // Get user's stored tokens from Firestore
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ 
        error: "User not found" 
      });
    }

    const userData = userDoc.data();
    const youtubeTokens = userData.youtubeTokens;
    const youtubeChannel = userData.youtubeChannel;

    if (!youtubeTokens?.refreshToken) {
      // If no refresh token but we have cached channel data, return it with warning
      if (youtubeChannel && youtubeChannel.channelTitle) {
        return res.status(200).json({ 
          success: true,
          channelData: youtubeChannel,
          warning: "Using cached data - no refresh token available",
          needsReconnect: true
        });
      }
      return res.status(400).json({ 
        error: "No refresh token found. Please reconnect your YouTube account.",
        needsReconnect: true
      });
    }

    // Try to refresh the token
    try {
      const refreshResult = await refreshTokenInternal(userId, youtubeTokens.refreshToken);
      
      res.status(200).json({ 
        success: true,
        accessToken: refreshResult.accessToken, 
        expiresAt: refreshResult.expiresAt.toDate(),
        refreshToken: refreshResult.refreshToken
      });
    } catch (refreshError) {
      console.error('Token refresh failed:', refreshError);
      
      // Fall back to cached data if available
      if (youtubeChannel && youtubeChannel.channelTitle) {
        return res.status(200).json({ 
          success: true,
          channelData: youtubeChannel,
          warning: "Using cached data - token refresh failed",
          needsReconnect: true
        });
      }
      
      return res.status(400).json({ 
        error: "Token refresh failed and no cached data available",
        details: refreshError.message,
        needsReconnect: true
      });
    }

  } catch (error) {
    console.error("YouTube token refresh error:", error);
    res.status(500).json({
      error: "Token refresh failed",
      details: error.message
    });
  }
});

// Validate YouTube access token
router.post('/validate-token', async (req, res) => {
  try {
    const { accessToken } = req.body;
    
    if (!accessToken) {
      return res.status(400).json({ 
        error: "Access token is required" 
      });
    }

    // Test the token by making a simple API call
    const response = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=id&mine=true',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    res.status(200).json({ 
      valid: response.ok,
      status: response.status
    });

  } catch (error) {
    console.error("Token validation error:", error);
    res.status(500).json({
      error: "Token validation failed",
      details: error.message
    });
  }
});

module.exports = router;
