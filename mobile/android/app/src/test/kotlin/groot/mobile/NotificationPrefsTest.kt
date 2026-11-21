package groot.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import groot.mobile.data.api.NotificationSettingsView
import groot.mobile.data.api.PushoverStatus
import groot.mobile.feature.settings.pushoverFacts
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NotificationPrefsTest {
    private val response = JSONObject(
        """
        {"settings":{"deliverTo":"webpush","events":{"routine.done":false},
          "quietHours":{"enabled":true,"start":"23:00","end":"06:30","timezone":"Europe/Berlin","urgentBypass":true},
          "device":"","longRunMinutes":10,"coalesceSeconds":30,"reminderMinutes":0,
          "throttle":{"perHour":12,"perBotPerMinute":2}},
         "events":[
          {"event":"approval.needed","label":"Approvals","description":"A bot waits for you.","category":"needs_input","defaultEnabled":true,"locked":true},
          {"event":"routine.done","label":"Routine finished","description":"A routine ran.","category":"notify","defaultEnabled":true},
          {"event":"reply.long","label":"Long reply","description":"A long reply ended.","category":"notify","defaultEnabled":false}
         ]}
        """,
    )

    @Test
    fun `an event is on when it is locked, saved on, or on by default`() {
        val view = NotificationSettingsView.from(response)
        val enabled = view.events.associate { it.event to view.settings.enabled(it) }
        assertEquals(mapOf("approval.needed" to true, "routine.done" to false, "reply.long" to false), enabled)
        assertTrue(view.settings.withEvent("reply.long", true).enabled(view.events[2]))
    }

    @Test
    fun `saving sends every field back, including the ones the phone does not edit`() {
        val view = NotificationSettingsView.from(response)
        val body = view.settings.copy(deliverTo = "pushover", longRunMinutes = 3).withEvent("reply.long", true).toJson()
        assertEquals(
            JSONObject(
                """
                {"deliverTo":"pushover","events":{"routine.done":false,"reply.long":true},
                 "quietHours":{"enabled":true,"start":"23:00","end":"06:30","timezone":"Europe/Berlin","urgentBypass":true},
                 "device":"","longRunMinutes":3,"coalesceSeconds":30,"reminderMinutes":0,
                 "throttle":{"perHour":12,"perBotPerMinute":2}}
                """,
            ).toString(),
            JSONObject(body.toString()).let { sorted(it) },
        )
        assertFalse(view.settings.toJson().has("unknown"))
    }

    @Test
    fun `pushover status reads like the web badge`() {
        val status = PushoverStatus.from(
            JSONObject("""{"channel":"pushover","state":"connected","requiredEnv":[],"devices":["pixel"],"quota":{"limit":10000,"remaining":9876,"reset":"x"}}"""),
        )
        assertEquals("Connected · pixel · 9876 of 10000 left this month", pushoverFacts(status))
    }

    private fun sorted(json: JSONObject): String {
        val expectedOrder = listOf("deliverTo", "events", "quietHours", "device", "longRunMinutes", "coalesceSeconds", "reminderMinutes", "throttle")
        val out = JSONObject()
        for (key in expectedOrder) out.put(key, json.get(key))
        assertEquals(expectedOrder.toSet(), json.keys().asSequence().toSet())
        return out.toString()
    }
}
