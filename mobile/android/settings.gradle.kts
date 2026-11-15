// SHARED (3-way merged): children add their own modules to include(...).
pluginManagement {
    includeBuild("build-logic")
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "groot-mobile"

include(":kit")
include(":app")
// Tiny Agents: protocol clients the app's live views and terminal are built on.
include(":vnc")
include(":terminal")
