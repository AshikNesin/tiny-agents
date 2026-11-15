import com.android.build.api.dsl.ApplicationExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure

/**
 * groot.android.application — SDK levels, R8 full mode + resource shrinking, lint, and
 * release signing from RELEASE_STORE_FILE, RELEASE_STORE_PASSWORD, RELEASE_KEY_ALIAS and
 * RELEASE_KEY_PASSWORD when they are set (Release Hub Publish sets them); otherwise unsigned.
 */
class AndroidApplicationConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("com.android.application")
        fun env(name: String): String? = providers.environmentVariable(name).orNull?.takeIf { it.isNotEmpty() }
        val storeFile = env("RELEASE_STORE_FILE")
        extensions.configure<ApplicationExtension> {
            compileSdk = GrootSdk.COMPILE
            defaultConfig {
                minSdk = GrootSdk.MIN
                targetSdk = GrootSdk.TARGET
            }
            compileOptions {
                sourceCompatibility = GrootSdk.JAVA
                targetCompatibility = GrootSdk.JAVA
            }
            if (storeFile != null) {
                signingConfigs.create("release") {
                    this.storeFile = file(storeFile)
                    storePassword = env("RELEASE_STORE_PASSWORD")
                    keyAlias = env("RELEASE_KEY_ALIAS")
                    keyPassword = env("RELEASE_KEY_PASSWORD")
                }
            }
            buildTypes {
                getByName("release") {
                    if (storeFile != null) signingConfig = signingConfigs.getByName("release")
                    isMinifyEnabled = true
                    isShrinkResources = true
                    proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
                }
            }
            lint {
                abortOnError = true
                checkDependencies = true
                warningsAsErrors = false
            }
        }
        configureKotlin()
    }
}
