package groot.mobile.data

import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

class FingerprintCancelled : Exception("Cancelled")

class FingerprintPassword(private val appContext: Context) {
    private val prefs = appContext.getSharedPreferences("fingerprint_password", Context.MODE_PRIVATE)

    val saved: Boolean get() = prefs.contains(CIPHERTEXT) && prefs.contains(IV)

    fun available(): Boolean {
        val manager = appContext.getSystemService(BiometricManager::class.java) ?: return false
        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        } else {
            @Suppress("DEPRECATION")
            manager.canAuthenticate()
        }
        return result == BiometricManager.BIOMETRIC_SUCCESS
    }

    suspend fun save(context: Context, password: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, newKey()) }
        val unlocked = prompt(context, cipher, "Use fingerprint for the vault", "Confirm to stop typing your password")
        val encrypted = unlocked.doFinal(password.toByteArray())
        prefs.edit()
            .putString(CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString(IV, Base64.encodeToString(unlocked.iv, Base64.NO_WRAP))
            .apply()
    }

    suspend fun password(context: Context): String {
        val key = existingKey() ?: run {
            forget()
            throw FingerprintCancelled()
        }
        val iv = Base64.decode(prefs.getString(IV, null), Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        try {
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        } catch (e: KeyPermanentlyInvalidatedException) {
            forget()
            throw FingerprintCancelled()
        }
        val unlocked = prompt(context, cipher, "Confirm it's you", "Use your fingerprint to continue")
        return String(unlocked.doFinal(Base64.decode(prefs.getString(CIPHERTEXT, null), Base64.NO_WRAP)))
    }

    fun forget() {
        prefs.edit().clear().apply()
        keyStore().deleteEntry(KEY_ALIAS)
    }

    private suspend fun prompt(context: Context, cipher: Cipher, title: String, subtitle: String): Cipher = suspendCancellableCoroutine { continuation ->
        val executor = context.mainExecutor
        val cancel = CancellationSignal()
        continuation.invokeOnCancellation { cancel.cancel() }
        val builder = BiometricPrompt.Builder(context)
            .setTitle(title)
            .setSubtitle(subtitle)
            .setNegativeButton("Use password", executor) { _, _ ->
                if (continuation.isActive) continuation.resumeWithException(FingerprintCancelled())
            }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        builder.build().authenticate(
            BiometricPrompt.CryptoObject(cipher),
            cancel,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    val unlocked = result.cryptoObject?.cipher
                    if (!continuation.isActive) return
                    if (unlocked != null) continuation.resume(unlocked) else continuation.resumeWithException(FingerprintCancelled())
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (continuation.isActive) continuation.resumeWithException(FingerprintCancelled())
                }
            },
        )
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private fun existingKey(): SecretKey? = keyStore().getKey(KEY_ALIAS, null) as? SecretKey

    private fun newKey(): SecretKey {
        val spec = KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
            .apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
                } else {
                    @Suppress("DEPRECATION")
                    setUserAuthenticationValidityDurationSeconds(-1)
                }
            }
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).apply { init(spec) }.generateKey()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "vault-step-up-password"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val CIPHERTEXT = "ciphertext"
        const val IV = "iv"
    }
}
