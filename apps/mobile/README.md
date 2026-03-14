# TrainMind Mobile (Prototype)

Minimal Expo app to test login + nutrition capture against local TrainMind backend.

## Prerequisites

- Node.js 20+
- Android Studio (Android Emulator) or Xcode (iOS Simulator)
- Running backend stack at `http://127.0.0.1:8000`

## Install

```powershell
cd apps/mobile
npm install
```

## Run in Emulator

```powershell
npm run start
```

Then press:

- `a` for Android emulator
- `i` for iOS simulator (macOS)

Notes:

- Android emulator reaches host machine via `10.0.2.2`, already configured in `App.tsx`.
- For iOS simulator, set `API_BASE_URL` in `App.tsx` to `http://127.0.0.1:8000/api`.

