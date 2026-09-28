# Quackulator — Android

WebView wrapper around `app/index.html`. Open the `android/` folder in Android Studio
(Hedgehog or newer), let it sync, run on the Pixel. The page is served from `assets/` through
`WebViewAssetLoader`, so Google Fonts load when online and fall back to system fonts offline.

To update the app after editing the web page: copy `app/index.html` over
`app/src/main/assets/index.html` (this copy carries the full `<html><head><body>` skeleton
that the published artifact adds automatically — keep the first line intact).

The hardware back button calls the page's `quackBack()` (screens and popups keep their own back
stack); the app only exits when that returns `false`, i.e. on the setup screen with nothing to go back to.

Launcher icons (`res/mipmap-*`, adaptive icon in `mipmap-anydpi-v26`) and the splash bitmap
(`drawable-xxhdpi/splash_duck.png`) are generated from the duck artwork (`duck.svg`, kept with the app
build scripts) by `gen_icons.py`; the page itself shows an animated duck splash for ~1.5 s on load.

