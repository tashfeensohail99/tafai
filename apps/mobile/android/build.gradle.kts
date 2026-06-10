allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// Force compileSdk ≥ 36 on every Android library subproject.
// Needed because file_picker 8.3.7 hardcodes compileSdk=34 in its own
// build.gradle while flutter_plugin_android_lifecycle 2.0.35 requires ≥ 36.
// We use gradle.beforeProject so we can register afterEvaluate safely even
// for plugin projects the Flutter loader evaluates before root evaluation ends.
gradle.beforeProject {
    afterEvaluate {
        val androidExt = extensions.findByName("android") ?: return@afterEvaluate
        try {
            val getter = androidExt.javaClass.getMethod("getCompileSdk")
            val current = getter.invoke(androidExt) as? Int ?: return@afterEvaluate
            if (current < 36) {
                // Find the setter regardless of primitive/boxed parameter type
                val setter = androidExt.javaClass.methods.firstOrNull { m ->
                    m.name == "setCompileSdk" && m.parameterCount == 1
                } ?: return@afterEvaluate
                val value: Any = if (setter.parameterTypes[0].isPrimitive) 36 else Integer.valueOf(36)
                setter.invoke(androidExt, value)
            }
        } catch (e: Exception) {
            // Older DSL uses compileSdkVersion(int) / compileSdkVersion(String)
            try {
                val setter = androidExt.javaClass.methods.firstOrNull { m ->
                    m.name == "compileSdkVersion" && m.parameterCount == 1 &&
                        m.parameterTypes[0] == String::class.java
                }
                setter?.invoke(androidExt, "android-36")
            } catch (ignored: Exception) { /* nothing to do */ }
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
