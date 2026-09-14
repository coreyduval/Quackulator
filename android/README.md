# Quackulator — Android

WebView wrapper around `app/index.html`. Open the `android/` folder in Android Studio
(Hedgehog or newer), let it sync, run on the Pixel. The page is served from `assets/` through
`WebViewAssetLoader`, so Google Fonts load when online and fall back to system fonts offline.

To update the app after editing the web page: copy `app/index.html` over
`app/src/main/assets/index.html` (this copy carries the full `<html><head><body>` skeleton
that the published artifact adds automatically — keep the first line intact).
