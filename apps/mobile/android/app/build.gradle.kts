import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // Firebase: processes google-services.json (FCM push for incoming calls).
    id("com.google.gms.google-services")
    // Crashlytics Gradle plugin — tags each build for crash deobfuscation.
    id("com.google.firebase.crashlytics")
}

// Release signing config, loaded from android/key.properties (gitignored, kept
// off version control). Falls back to debug signing when the keystore isn't
// present — e.g. CI or a fresh clone — so those still build.
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    namespace = "com.tashfeengroup.sales"
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.tashfeengroup.sales"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        // flutter_webrtc requires API 23+; CallKit full-screen ring wants 23+ too.
        minSdk = maxOf(23, flutter.minSdkVersion)
        // Pinned to 33 (Android 13) — do NOT change back to flutter.targetSdkVersion
        // (currently 36). On API 34+ Android stopped auto-granting
        // USE_FULL_SCREEN_INTENT to non-dialer apps, so the incoming-call screen
        // rings but never shows the accept/reject dialer until the user manually
        // turns on "Full screen notifications" (and MIUI also blocks the overlay).
        // Targeting 33 grants the full-screen intent at install, so the ringing
        // call UI works on every phone with zero per-device toggling. Safe because
        // the app is sideloaded (no Play Store targetSdk floor) and the calling /
        // foreground-service features run fine at 33. Raising this re-breaks the
        // call dialer — see memory tafai-mobile-call-fsi.
        targetSdk = 33
        multiDexEnabled = true
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            if (keystorePropertiesFile.exists()) {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
            // Budget OEM ROMs (Infinix / Tecno / itel — Transsion) reject v2-only
            // APKs with "package appears to be invalid". AGP silently drops the
            // v1 (JAR) signature once minSdk >= 24, so force BOTH schemes on for
            // maximum sideload compatibility across the low-end Android fleet the
            // reps carry. Costs a few KB; strictly increases what can install.
            enableV1Signing = true
            enableV2Signing = true
        }
    }

    buildTypes {
        release {
            // Sign with the real release key when key.properties + keystore are
            // present; otherwise fall back to debug keys so CI / fresh clones
            // (which don't have the keystore) still produce a build.
            signingConfig = if (keystorePropertiesFile.exists()) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
