package groot.mobile.data.api

import org.json.JSONObject

data class NotificationEventDef(
    val event: String,
    val label: String,
    val description: String,
    val category: String,
    val defaultEnabled: Boolean,
    val locked: Boolean,
) {
    companion object {
        fun from(json: JSONObject) = NotificationEventDef(
            event = json.string("event"),
            label = json.string("label"),
            description = json.string("description"),
            category = json.string("category"),
            defaultEnabled = json.bool("defaultEnabled"),
            locked = json.bool("locked"),
        )
    }
}

data class QuietHours(
    val enabled: Boolean,
    val start: String,
    val end: String,
    val timezone: String,
    val urgentBypass: Boolean,
)

data class NotificationPrefs(
    val deliverTo: String,
    val events: Map<String, Boolean>,
    val quietHours: QuietHours,
    val device: String,
    val longRunMinutes: Int,
    val coalesceSeconds: Int,
    val reminderMinutes: Int,
    private val raw: JSONObject = JSONObject(),
) {
    fun enabled(def: NotificationEventDef): Boolean = def.locked || (events[def.event] ?: def.defaultEnabled)

    fun withEvent(event: String, on: Boolean): NotificationPrefs = copy(events = events + (event to on))

    fun toJson(): JSONObject {
        val out = JSONObject(raw.toString())
        out.put("deliverTo", deliverTo)
        out.put("events", JSONObject(events))
        out.put(
            "quietHours",
            jsonOf(
                "enabled" to quietHours.enabled,
                "start" to quietHours.start,
                "end" to quietHours.end,
                "timezone" to quietHours.timezone,
                "urgentBypass" to quietHours.urgentBypass,
            ),
        )
        out.put("device", device)
        out.put("longRunMinutes", longRunMinutes)
        out.put("coalesceSeconds", coalesceSeconds)
        out.put("reminderMinutes", reminderMinutes)
        return out
    }

    companion object {
        fun from(json: JSONObject): NotificationPrefs {
            val quiet = json.objOrNull("quietHours") ?: JSONObject()
            val events = json.objOrNull("events") ?: JSONObject()
            return NotificationPrefs(
                deliverTo = json.string("deliverTo", "auto"),
                events = events.keys().asSequence().associateWith { events.optBoolean(it) },
                quietHours = QuietHours(
                    enabled = quiet.bool("enabled"),
                    start = quiet.string("start", "22:00"),
                    end = quiet.string("end", "07:00"),
                    timezone = quiet.string("timezone", "Asia/Kolkata"),
                    urgentBypass = quiet.bool("urgentBypass"),
                ),
                device = json.string("device"),
                longRunMinutes = json.int("longRunMinutes", 5),
                coalesceSeconds = json.int("coalesceSeconds", 30),
                reminderMinutes = json.int("reminderMinutes", 15),
                raw = json,
            )
        }
    }
}

data class NotificationSettingsView(val settings: NotificationPrefs, val events: List<NotificationEventDef>) {
    companion object {
        fun from(json: JSONObject) = NotificationSettingsView(
            settings = NotificationPrefs.from(json.objOrNull("settings") ?: JSONObject()),
            events = json.arr("events").mapObjects(NotificationEventDef::from),
        )
    }
}

data class PushoverStatus(
    val state: String,
    val requiredEnv: List<String>,
    val devices: List<String>,
    val quotaRemaining: Int?,
    val quotaLimit: Int?,
    val lastError: String?,
) {
    companion object {
        fun from(json: JSONObject): PushoverStatus {
            val quota = json.objOrNull("quota")
            val error = json.objOrNull("lastError")
            return PushoverStatus(
                state = json.string("state", "unknown"),
                requiredEnv = json.arr("requiredEnv").strings(),
                devices = json.arr("devices").strings(),
                quotaRemaining = quota?.intOrNull("remaining"),
                quotaLimit = quota?.intOrNull("limit"),
                lastError = error?.let { it.stringOrNull("detail") ?: it.stringOrNull("reason") },
            )
        }
    }
}
