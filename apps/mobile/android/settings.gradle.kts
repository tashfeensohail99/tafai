pluginManagement {
    val flutterSdkPath =
        run {
            val properties = java.util.Properties()
            file("local.properties").inputStream().use { properties.load(it) }
            val flutterSdkPath = properties.getProperty("flutter.sdk")
            require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
            flutterSdkPath
        }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "9.0.1" apply false
    id("org.jetbrains.kotlin.android") version "2.3.20" apply false
    // Firebase Google Services (FCM push). Applied in app/build.gradle.kts.
    id("com.google.gms.google-services") version "4.4.2" apply false
    // Firebase Crashlytics — uploads native symbols + tags builds so crash
    // reports are deobfuscated. Applied in app/build.gradle.kts.
    id("com.google.firebase.crashlytics") version "3.0.2" apply false
}

include(":app")
