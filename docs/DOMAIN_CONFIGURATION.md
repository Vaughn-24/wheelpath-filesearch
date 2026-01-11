# Domain Configuration Guide

## Overview
All domains should point to the same landing page, pilot page, and backend app:
- `www.wheelpath.ai` → redirects to `wheelpath.ai` (301 redirect)
- `wheelpath.ai` → serves the app via Cloudflare Pages
- `wheelpath-landing.pages.dev` → serves the app via Cloudflare Pages

## Backend API Configuration ✅

The API CORS has been updated to accept requests from:
- `https://www.wheelpath.ai`
- `https://wheelpath.ai`
- `https://wheelpath-landing.pages.dev`
- All Cloudflare Pages preview deployments

## Cloudflare Pages Configuration Required

### 1. Custom Domains Setup

In Cloudflare Pages dashboard, ensure these custom domains are configured:
- `wheelpath.ai` (primary)
- `www.wheelpath.ai` (will redirect to non-www)

### 2. DNS Configuration

Ensure DNS records point to Cloudflare Pages:

**For wheelpath.ai:**
```
Type: CNAME
Name: @
Target: wheelpath-landing.pages.dev
Proxy: Proxied (orange cloud)
```

**For www.wheelpath.ai:**
```
Type: CNAME
Name: www
Target: wheelpath-landing.pages.dev
Proxy: Proxied (orange cloud)
```

### 3. Redirect Configuration

The Cloudflare Pages function (`cloudflare-pages/functions/[[path]].ts`) now includes:
- Automatic redirect from `www.wheelpath.ai` → `wheelpath.ai` (301)

### 4. Environment Variables

Ensure all Cloudflare Pages deployments have the same environment variables:
- `NEXT_PUBLIC_API_URL` - Should point to: `https://wheelpath-api-945257727887.us-central1.run.app`
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

## Verification Checklist

- [ ] `wheelpath.ai` loads the app correctly
- [ ] `www.wheelpath.ai` redirects to `wheelpath.ai` (301)
- [ ] `wheelpath-landing.pages.dev` loads the app correctly
- [ ] All domains can authenticate with Google OAuth
- [ ] All domains can connect to the backend API
- [ ] All domains can use voice features (WebSocket connections work)

## Testing

After deployment, test each domain:
1. Visit `https://wheelpath.ai` - should load app
2. Visit `https://www.wheelpath.ai` - should redirect to `wheelpath.ai`
3. Visit `https://wheelpath-landing.pages.dev` - should load app
4. Sign in with Google on each domain - should work
5. Upload a document - should work
6. Use voice chat - should connect to WebSocket

## Notes

- The Cloudflare Pages function proxies all requests to Cloud Run (`wheelpath-web-l2phyyl55q-uc.a.run.app`)
- All domains share the same backend API
- CORS is configured to accept requests from all three domains
- The redirect ensures consistent canonical URL (non-www)
