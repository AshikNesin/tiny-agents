package groot.mobile.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

private val Context.appPreferencesDataStore: DataStore<Preferences> by preferencesDataStore(name = "app_prefs")

class AppPreferences(private val dataStore: DataStore<Preferences>) {
    val showHomeIntro: Flow<Boolean> = dataStore.data
        .map { it[SHOW_HOME_INTRO] ?: true }
        .distinctUntilChanged()

    suspend fun setShowHomeIntro(show: Boolean) {
        dataStore.edit { it[SHOW_HOME_INTRO] = show }
    }

    val livePip: Flow<Boolean> = dataStore.data
        .map { it[LIVE_PIP] ?: false }
        .distinctUntilChanged()

    suspend fun setLivePip(pip: Boolean) {
        dataStore.edit { it[LIVE_PIP] = pip }
    }

    val pipCorner: Flow<PipCorner> = dataStore.data
        .map { prefs -> PipCorner.entries.firstOrNull { it.name == prefs[PIP_CORNER] } ?: PipCorner.TopEnd }
        .distinctUntilChanged()

    suspend fun setPipCorner(corner: PipCorner) {
        dataStore.edit { it[PIP_CORNER] = corner.name }
    }

    suspend fun clear() {
        dataStore.edit { it.clear() }
    }

    companion object {
        private val SHOW_HOME_INTRO = booleanPreferencesKey("show_home_intro")
        private val LIVE_PIP = booleanPreferencesKey("live_pip")
        private val PIP_CORNER = stringPreferencesKey("pip_corner")

        fun create(context: Context) = AppPreferences(context.applicationContext.appPreferencesDataStore)
    }
}
