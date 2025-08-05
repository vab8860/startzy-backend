# Startzy Backend

Backend API for Startzy - Instagram and YouTube OAuth integration.

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables (create `.env` file)
4. Start the development server:
   ```bash
   npm run dev
   ```

## Production

```bash
npm start
```

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```
# Add your environment variables here
FIREBASE_PROJECT_ID=your-project-id
# Add other required environment variables
```

## API Endpoints

- `/api/auth/instagram` - Instagram OAuth
- `/api/auth/youtube` - YouTube OAuth
- Add other endpoints as needed

## Deployment

This backend is designed to be deployed on platforms like Render, Railway, or similar Node.js hosting services.
