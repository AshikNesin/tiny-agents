package groot.mobile

import android.app.Application
import android.content.Context
import groot.kit.buildinfo.BuildInfo
import groot.kit.log.Log
import groot.kit.theme.ThemeModeStore
import groot.mobile.data.AppLinks
import groot.mobile.data.AppPreferences
import groot.mobile.data.AvatarStore
import groot.mobile.data.BotsStore
import groot.mobile.data.FileActions
import groot.mobile.data.ImageStore
import groot.mobile.data.Notices
import groot.mobile.data.SessionStore
import groot.mobile.data.ShareTarget
import groot.mobile.data.ShareTargets
import groot.mobile.data.StepUp
import groot.mobile.data.api.ApiClient
import groot.mobile.data.api.CodeApi
import groot.mobile.data.api.TinyAgentsApi
import groot.mobile.data.chat.ChatStore
import groot.mobile.data.shareTargetBots
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

class GrootMobileApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        Log.enabled = BuildConfig.DEBUG
        container = AppContainer(this)
    }
}

/** Manual dependency wiring; no DI framework (RFC 0001 §3). */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    /** Lives as long as the process: the stores' streams and sends run on it. */
    val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val themeModeStore: ThemeModeStore = ThemeModeStore.create(appContext)

    val appPreferences: AppPreferences = AppPreferences.create(appContext)

    /** Lazy: the kit reads nothing but the theme key at startup. */
    val buildInfo: BuildInfo by lazy { BuildInfo.from(appContext, commit = BuildConfig.GIT_COMMIT) }

    val notices = Notices()

    val session: SessionStore = SessionStore.create(appContext, scope)

    private val client = ApiClient(session)

    val api = TinyAgentsApi(client)

    /** The Code page's routes: coding agents, their threads, changes and pull requests. */
    val code = CodeApi(client)

    val bots = BotsStore(api, scope, notices)

    val chats = ChatStore(api, scope, notices)

    val images = ImageStore(api)

    /** Bot faces; not tied to the session, so they stay across sign-outs. */
    val avatars = AvatarStore(appContext.cacheDir)

    val files = FileActions(appContext, api)

    val stepUp = StepUp(api)

    /** Links the app was opened with (a push notification's), waiting for the signed-in screens. */
    val links = AppLinks()

    /** The top bots, offered by name and face in Android's share sheet. */
    val shareTargets = ShareTargets(appContext, avatars)

    init {
        // A session starting loads the bots and follows the feed; one ending forgets everything.
        scope.launch {
            session.state.map { it.signedIn to it.serverUrl }.distinctUntilChanged().collect { (signedIn, _) ->
                bots.stop()
                chats.clear()
                images.clear()
                stepUp.clear()
                if (signedIn) bots.start()
            }
        }
        // Signed in, the share sheet offers the top bots once their list is in; signed out, none.
        scope.launch {
            combine(session.state, bots.state) { session, bots ->
                when {
                    !session.signedIn -> emptyList<ShareTarget>() to null
                    bots.loading -> null
                    else -> shareTargetBots(bots, shareTargets.max).map { ShareTarget(it.id, it.name) } to session.serverUrl
                }
            }.filterNotNull().distinctUntilChanged().collectLatest { (targets, serverUrl) -> shareTargets.publish(targets, serverUrl) }
        }
    }
}
