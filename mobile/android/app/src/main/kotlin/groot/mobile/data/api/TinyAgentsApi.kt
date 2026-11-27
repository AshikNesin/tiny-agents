package groot.mobile.data.api

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.BufferedSink
import okio.source
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.net.URLEncoder

data class SignIn(val token: String, val user: SessionUser)

class TinyAgentsApi(private val client: ApiClient) {
    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private fun list(data: Any?): JSONArray = data as? JSONArray ?: JSONArray()

    fun socket(path: String, listener: WebSocketListener): WebSocket = client.webSocket(path, listener)

    suspend fun needsSetup(): Boolean = client.getObject("/auth/setup").bool("needsSetup")

    suspend fun login(email: String, password: String): SignIn =
        signIn(client.postObject("/auth/login", jsonOf("email" to email, "password" to password)))

    suspend fun setup(email: String, password: String, name: String?): SignIn =
        signIn(client.postObject("/auth/setup", jsonOfNotNull("email" to email, "password" to password, "name" to name)))

    private fun signIn(json: JSONObject) =
        SignIn(json.string("token"), SessionUser.from(json.objOrNull("user") ?: JSONObject()))

    suspend fun me(): SessionUser = SessionUser.from(client.getObject("/auth/me"))

    suspend fun logout() {
        client.post("/auth/logout")
    }

    suspend fun isGuest(): Boolean = client.getObject("/people/me").bool("guest")

    suspend fun bots(): List<BotListEntry> = list(client.get("/bots")).mapObjects(BotListEntry::from)

    suspend fun bot(id: String): Bot = Bot.from(client.getObject("/bots/${enc(id)}"))

    suspend fun createBot(draft: BotDraft): Bot = Bot.from(client.postObject("/bots", draft.toJson()))

    suspend fun updateBot(id: String, draft: BotDraft): Bot =
        Bot.from(client.patch("/bots/${enc(id)}", draft.toJson()) as? JSONObject ?: JSONObject())

    suspend fun deleteBot(id: String) {
        client.delete("/bots/${enc(id)}")
    }

    suspend fun pinBot(id: String, pinned: Boolean) {
        client.post("/bots/${enc(id)}/pin", jsonOf("pinned" to pinned))
    }

    suspend fun markRead(id: String) {
        client.post("/bots/${enc(id)}/read")
    }

    suspend fun models(): ModelsResponse = ModelsResponse.from(client.getObject("/models"))

    suspend fun capabilities(): List<Capability> =
        client.getObject("/capabilities").arr("capabilities").mapObjects(Capability::from)

    fun botStream(id: String) = client.events("/bots/${enc(id)}/stream")

    fun eventsFeed() = client.events("/events")

    suspend fun sendMessage(
        botId: String,
        requestId: String,
        text: String,
        attachments: List<String> = emptyList(),
        mentions: List<String> = emptyList(),
        whenBusy: String? = null,
    ) {
        client.post(
            "/bots/${enc(botId)}/messages",
            jsonOfNotNull(
                "requestId" to requestId,
                "text" to text,
                "attachments" to attachments.takeIf { it.isNotEmpty() },
                "mentions" to mentions.takeIf { it.isNotEmpty() },
                "whenBusy" to whenBusy,
            ),
        )
    }

    suspend fun withdrawMessage(botId: String, requestId: String) {
        client.delete("/bots/${enc(botId)}/messages/${enc(requestId)}")
    }

    suspend fun history(botId: String, before: String, limit: Int = 50): ChatPage =
        ChatPage.from(client.getObject("/bots/${enc(botId)}/messages", mapOf("before" to before, "limit" to limit.toString())))

    suspend fun abort(botId: String) {
        client.post("/bots/${enc(botId)}/abort")
    }

    suspend fun resetChat(botId: String) {
        client.post("/bots/${enc(botId)}/reset")
    }

    suspend fun decideApproval(botId: String, taskId: Int, approved: Boolean, alwaysAllow: String? = null, grant: Boolean = false, everyBot: Boolean = false) {
        client.post(
            "/bots/${enc(botId)}/approvals/$taskId",
            jsonOfNotNull(
                "decision" to if (approved) "approved" else "denied",
                "alwaysAllow" to alwaysAllow,
                "grant" to true.takeIf { grant },
                "everyBot" to true.takeIf { everyBot },
            ),
        )
    }

    suspend fun vapidKey(): String = client.getObject("/notifications/vapid-key").string("publicKey")

    suspend fun registerPushDevice(device: PushDeviceBody): String =
        client.postObject("/notifications/devices", device.toJson()).string("id")

    suspend fun removePushDevice(id: String) {
        client.delete("/notifications/devices/${enc(id)}")
    }

    suspend fun testPushDevice(id: String): String? {
        val result = client.postObject("/notifications/devices/${enc(id)}/test")
        return if (result.bool("ok")) null else result.string("reason", "failed")
    }

    suspend fun notificationSettings(): NotificationSettingsView =
        NotificationSettingsView.from(client.getObject("/notifications/settings"))

    suspend fun saveNotificationSettings(prefs: NotificationPrefs): NotificationSettingsView =
        NotificationSettingsView.from(client.put("/notifications/settings", prefs.toJson()) as? JSONObject ?: JSONObject())

    suspend fun pushoverStatus(): PushoverStatus = PushoverStatus.from(client.getObject("/notifications/status"))

    suspend fun checkPushover(): PushoverStatus = PushoverStatus.from(client.postObject("/notifications/validate"))

    suspend fun testPushover(): String? {
        val result = client.postObject("/notifications/test")
        return if (result.bool("ok")) null else result.stringOrNull("detail") ?: result.string("reason", "failed")
    }

    suspend fun answerQuestions(botId: String, taskId: Int, answers: List<OwnerAnswer>?) {
        val body = if (answers != null) jsonOf("answers" to answers.map { it.toJson() }) else jsonOf("dismissed" to true)
        client.post("/bots/${enc(botId)}/questions/$taskId", body)
    }

    suspend fun setYolo(botId: String, on: Boolean) {
        client.put("/bots/${enc(botId)}/yolo", jsonOf("on" to on))
    }

    suspend fun pastChats(botId: String): List<PastChat> =
        client.getObject("/bots/${enc(botId)}/chats").arr("chats").mapObjects(PastChat::from)

    suspend fun pastChat(botId: String, chatId: String): PastChatView =
        PastChatView.from(client.getObject("/bots/${enc(botId)}/chats/${enc(chatId)}"))

    suspend fun pastChatHistory(botId: String, chatId: String, before: String, limit: Int = 50): ChatPage =
        ChatPage.from(
            client.getObject("/bots/${enc(botId)}/chats/${enc(chatId)}/messages", mapOf("before" to before, "limit" to limit.toString())),
        )

    suspend fun continuePastChat(botId: String, chatId: String) {
        client.post("/bots/${enc(botId)}/chats/${enc(chatId)}/continue")
    }

    suspend fun deletePastChat(botId: String, chatId: String) {
        client.delete("/bots/${enc(botId)}/chats/${enc(chatId)}")
    }

    suspend fun upload(fileName: String, mimeType: String, length: Long, open: () -> InputStream): AttachmentRef {
        val body = object : RequestBody() {
            override fun contentType() = mimeType.toMediaTypeOrNull()
            override fun contentLength() = length
            override fun writeTo(sink: BufferedSink) {
                open().use { stream -> sink.writeAll(stream.source()) }
            }
        }
        val stored = client.upload("/uploads", fileName, mimeType, body)
        return AttachmentRef.from(stored.objOrNull("ref") ?: JSONObject())
    }

    suspend fun uploadContent(uploadId: String): Response = client.download("/uploads/${enc(uploadId)}/content")

    suspend fun deleteUpload(uploadId: String) {
        client.delete("/uploads/${enc(uploadId)}")
    }

    suspend fun uploadText(uploadId: String, page: Int = 1): UploadText {
        val json = client.getObject("/uploads/${enc(uploadId)}/text", mapOf("page" to page.toString()))
        val rows = json.arr("rows")
        return UploadText(
            status = json.string("status"),
            error = json.stringOrNull("error"),
            page = json.int("page", 1),
            pages = json.int("pages", 1),
            text = json.stringOrNull("text"),
            rows = (0 until rows.length()).map { rows.optJSONArray(it)?.strings() ?: emptyList() },
            entries = json.arr("entries").mapObjects { it.string("path", it.string("name")) },
        )
    }

    suspend fun botLiveStatus(botId: String, surface: String): LiveStatus =
        LiveStatus.from(client.getObject("/bots/${enc(botId)}/$surface"))

    suspend fun botLiveStart(botId: String, surface: String) {
        client.post("/bots/${enc(botId)}/$surface/start")
    }

    suspend fun botLiveTicket(botId: String, surface: String): VncTicket =
        ticket(client.postObject("/bots/${enc(botId)}/$surface/vnc-ticket"))

    suspend fun botLiveDriver(botId: String, surface: String, human: Boolean) {
        client.post("/bots/${enc(botId)}/$surface/driver", jsonOf("driver" to if (human) "human" else "agent"))
    }

    suspend fun botLiveResize(botId: String, width: Int, height: Int) {
        client.post("/bots/${enc(botId)}/browser/resize", jsonOf("width" to width, "height" to height))
    }

    suspend fun botLiveReset(botId: String, surface: String) {
        client.delete("/bots/${enc(botId)}/$surface/profile")
    }

    suspend fun liveProfiles(surface: String): LiveProfileList = LiveProfileList.from(client.getObject("/$surface"))

    suspend fun profileStart(surface: String, profile: String) {
        client.post("/$surface/${enc(profile)}/start")
    }

    suspend fun profileTicket(surface: String, profile: String): VncTicket =
        ticket(client.postObject("/$surface/${enc(profile)}/vnc-ticket"))

    suspend fun profileDriver(surface: String, profile: String, human: Boolean) {
        client.post("/$surface/${enc(profile)}/driver", jsonOf("driver" to if (human) "human" else "agent"))
    }

    suspend fun profileResize(profile: String, width: Int, height: Int) {
        client.post("/browser/${enc(profile)}/resize", jsonOf("width" to width, "height" to height))
    }

    suspend fun profileReset(surface: String, profile: String) {
        client.delete("/$surface/${enc(profile)}")
    }

    suspend fun desktopApps(profile: String): List<DesktopApp> =
        client.getObject("/computer/${enc(profile)}/apps").arr("apps").mapObjects { DesktopApp(it.string("id"), it.string("name")) }

    suspend fun openDesktopApp(profile: String, appId: String) {
        client.post("/computer/${enc(profile)}/apps", jsonOf("id" to appId))
    }

    private fun ticket(json: JSONObject) = VncTicket(json.string("path"), json.doubleOrNull("scale") ?: 1.0)

    suspend fun terminalTabs(): TerminalList = TerminalList.from(client.getObject("/terminal/sessions"))

    suspend fun createTerminalTab(cols: Int, rows: Int): TerminalTab =
        TerminalTab.from(client.postObject("/terminal/sessions", jsonOf("cols" to cols, "rows" to rows)))

    suspend fun closeTerminalTab(name: String, force: Boolean = false) {
        client.delete("/terminal/sessions/${enc(name)}", if (force) mapOf("force" to "1") else emptyMap())
    }

    suspend fun terminalTicket(name: String): String = client.postObject("/terminal/sessions/${enc(name)}/ticket").string("path")

    suspend fun routines(): List<Routine> = list(client.get("/routines")).mapObjects(Routine::from)

    suspend fun createRoutine(botId: String, name: String, prompt: String, schedule: Schedule): Routine =
        Routine.from(client.postObject("/routines", jsonOf("botId" to botId, "name" to name, "prompt" to prompt, "schedule" to schedule.toJson())))

    suspend fun updateRoutine(id: String, botId: String?, name: String?, prompt: String?, schedule: Schedule?): Routine =
        Routine.from(
            client.patch(
                "/routines/${enc(id)}",
                jsonOfNotNull("botId" to botId, "name" to name, "prompt" to prompt, "schedule" to schedule?.toJson()),
            ) as? JSONObject ?: JSONObject(),
        )

    suspend fun deleteRoutine(id: String) {
        client.delete("/routines/${enc(id)}")
    }

    suspend fun pauseRoutine(id: String) {
        client.post("/routines/${enc(id)}/pause")
    }

    suspend fun resumeRoutine(id: String) {
        client.post("/routines/${enc(id)}/resume")
    }

    suspend fun runRoutine(id: String) {
        client.post("/routines/${enc(id)}/run")
    }

    suspend fun routineRuns(id: String, limit: Int = 20): List<RoutineRun> =
        client.getObject("/routines/${enc(id)}/runs", mapOf("limit" to limit.toString())).arr("runs").mapObjects(RoutineRun::from)

    suspend fun tasks(): List<OwnerTask> = list(client.get("/tasks")).mapObjects(OwnerTask::from)

    suspend fun createTask(title: String, description: String = "", priority: String = "medium"): OwnerTask =
        OwnerTask.from(client.postObject("/tasks", jsonOf("title" to title, "description" to description, "priority" to priority)))

    suspend fun updateTask(id: String, title: String? = null, description: String? = null, status: String? = null, priority: String? = null): OwnerTask =
        OwnerTask.from(
            client.patch("/tasks/${enc(id)}", jsonOfNotNull("title" to title, "description" to description, "status" to status, "priority" to priority))
                as? JSONObject ?: JSONObject(),
        )

    suspend fun deleteTask(id: String) {
        client.delete("/tasks/${enc(id)}")
    }

    suspend fun skills(): List<Skill> = list(client.get("/skills")).mapObjects(Skill::from)

    suspend fun createSkill(name: String, description: String, body: String): Skill =
        Skill.from(client.postObject("/skills", jsonOf("name" to name, "description" to description, "body" to body)))

    suspend fun updateSkill(id: String, name: String? = null, description: String? = null, body: String? = null, botIds: List<String>? = null, allBots: Boolean? = null): Skill =
        Skill.from(
            client.patch("/skills/${enc(id)}", jsonOfNotNull("name" to name, "description" to description, "body" to body, "botIds" to botIds, "allBots" to allBots))
                as? JSONObject ?: JSONObject(),
        )

    suspend fun deleteSkill(id: String) {
        client.delete("/skills/${enc(id)}")
    }

    suspend fun memories(botId: String, includeArchived: Boolean = true): List<Memory> =
        client.getObject("/bots/${enc(botId)}/memories", mapOf("includeArchived" to includeArchived.toString()))
            .arr("memories").mapObjects(Memory::from)

    suspend fun createMemory(botId: String, text: String, category: String): Memory =
        Memory.from(client.postObject("/bots/${enc(botId)}/memories", jsonOf("text" to text, "category" to category)).objOrNull("memory") ?: JSONObject())

    suspend fun updateMemory(id: String, text: String? = null, category: String? = null, restore: Boolean? = null): Memory =
        Memory.from(
            (client.patch("/memories/${enc(id)}", jsonOfNotNull("text" to text, "category" to category, "restore" to restore)) as? JSONObject)
                ?.objOrNull("memory") ?: JSONObject(),
        )

    suspend fun deleteMemory(id: String) {
        client.delete("/memories/${enc(id)}")
    }

    suspend fun connections(): List<Connection> = list(client.get("/connections")).mapObjects(Connection::from)

    suspend fun connection(id: String): Connection = Connection.from(client.getObject("/connections/${enc(id)}"))

    suspend fun createConnection(name: String, url: String, headerName: String?, secret: String?, stepUp: String): Connection =
        Connection.from(
            client.postObject(
                "/connections",
                jsonOfNotNull(
                    "name" to name,
                    "url" to url,
                    "authType" to if (headerName != null && secret != null) "header" else "none",
                    "headerName" to headerName,
                    "secret" to secret,
                ),
                stepUpHeader(stepUp),
            ),
        )

    suspend fun setConnectionBots(id: String, botIds: List<String>): Connection =
        Connection.from(client.patch("/connections/${enc(id)}", jsonOf("botIds" to botIds)) as? JSONObject ?: JSONObject())

    suspend fun setConnectionAllBots(id: String, allBots: Boolean): Connection =
        Connection.from(client.patch("/connections/${enc(id)}", jsonOf("allBots" to allBots)) as? JSONObject ?: JSONObject())

    suspend fun deleteConnection(id: String, stepUp: String) {
        client.delete("/connections/${enc(id)}", headers = stepUpHeader(stepUp))
    }

    suspend fun reconnectConnection(id: String) {
        client.post("/connections/${enc(id)}/reconnect")
    }

    suspend fun authorizeConnection(id: String): String? =
        client.postObject("/connections/${enc(id)}/authorize").stringOrNull("authorizationUrl")

    suspend fun setConnectionTool(id: String, serverName: String, enabled: Boolean) {
        client.patch("/connections/${enc(id)}/tools/${enc(serverName)}", jsonOf("enabled" to enabled))
    }

    suspend fun vaultOverview(refresh: Boolean = false): VaultOverview =
        VaultOverview.from(client.getObject("/vault", if (refresh) mapOf("refresh" to "1") else emptyMap()))

    suspend fun vaultItem(handle: String): VaultItemDetail = VaultItemDetail.from(client.getObject("/vault/items/${enc(handle)}"))

    suspend fun stepUp(password: String): StepUpToken = stepUpWith(jsonOf("password" to password))

    suspend fun stepUpPasskeyOptions(): String = client.postObject("/vault/step-up/options").toString()

    suspend fun stepUpWithPasskey(responseJson: String): StepUpToken = stepUpWith(JSONObject().put("passkey", JSONObject(responseJson)))

    private suspend fun stepUpWith(body: JSONObject): StepUpToken {
        val json = client.postObject("/vault/step-up", body)
        return StepUpToken(json.string("token"), json.long("expiresAt"))
    }

    suspend fun revealVaultValue(handle: String, field: String, stepUp: String, purpose: String = "reveal"): String =
        client.postObject("/vault/items/${enc(handle)}/reveal", jsonOf("field" to field, "purpose" to purpose), stepUpHeader(stepUp)).string("value")

    suspend fun createVaultItem(body: JSONObject): VaultItem =
        VaultItem.from(client.postObject("/vault/items", body))

    suspend fun linkVaultItem(backend: String, externalId: String, policy: JSONObject, stepUp: String): VaultItem =
        VaultItem.from(client.postObject("/vault/links", jsonOf("backend" to backend, "externalId" to externalId, "policy" to policy), stepUpHeader(stepUp)))

    suspend fun moveVaultToOnePassword(): VaultMoveResult =
        VaultMoveResult.from(client.postObject("/vault/move-to-1password", JSONObject()))

    suspend fun updateVaultItem(handle: String, body: JSONObject, stepUp: String? = null): VaultItem =
        VaultItem.from(client.put("/vault/items/${enc(handle)}", body, stepUp?.let { stepUpHeader(it) } ?: emptyMap()) as? JSONObject ?: JSONObject())

    suspend fun deleteVaultItem(handle: String, purge: Boolean, stepUp: String) {
        client.delete("/vault/items/${enc(handle)}", mapOf("purge" to purge.toString()), stepUpHeader(stepUp))
    }

    suspend fun credentialRequest(taskId: Int): CredentialRequestView =
        CredentialRequestView.from(client.getObject("/vault/requests/$taskId"))

    suspend fun submitCredentials(taskId: Int, values: Map<String, String>, save: Boolean) {
        client.post("/vault/requests/$taskId/submit", jsonOf("values" to values, "save" to save))
    }

    suspend fun cancelCredentialRequest(taskId: Int) {
        client.post("/vault/requests/$taskId/cancel")
    }

    private fun stepUpHeader(token: String) = mapOf("X-Vault-Step-Up" to token)

    suspend fun guests(): List<Guest> = client.getObject("/people").arr("guests").mapObjects(Guest::from)

    suspend fun addGuest(email: String, password: String, name: String?): Guest =
        Guest.from(client.postObject("/people", jsonOfNotNull("email" to email, "password" to password, "name" to name)))

    suspend fun removeGuest(id: Int) {
        client.delete("/people/$id")
    }
}
