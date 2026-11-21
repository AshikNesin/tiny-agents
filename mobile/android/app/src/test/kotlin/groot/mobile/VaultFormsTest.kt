package groot.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import groot.mobile.data.api.VaultItem
import groot.mobile.data.api.VaultOverview
import groot.mobile.data.vault.VaultPolicyDraft
import groot.mobile.data.vault.suggestHandle
import groot.mobile.data.vault.vaultCreateBody
import groot.mobile.data.vault.vaultPolicyBody
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class VaultFormsTest {
    @Test
    fun `a new login is sent the way the web form sends it`() {
        val body = vaultCreateBody(
            kind = "login",
            title = " GitHub ",
            website = "github.com/login  https://gist.github.com",
            values = mapOf("username" to "ana", "password" to "pw", "totp" to ""),
            policy = VaultPolicyDraft.defaultFor("login", suggestHandle("GitHub (work)")),
        )
        assertEquals(
            JSONObject(
                """{"kind":"login","title":"GitHub","urls":["https://github.com/login","https://gist.github.com"],
                   "values":{"username":"ana","password":"pw"},
                   "policy":{"handle":"github-work","origins":[],"hosts":[],"tools":[],"approval":"per_conversation",
                             "allowUnattended":false,"whenToUse":"","disabled":false,"inject":null,"bots":null}}""",
            ).toString(),
            body.toString(),
        )
    }

    @Test
    fun `a card always asks and never runs unattended, and an API key keeps its header`() {
        val card = VaultPolicyDraft("amex", approval = "allowed", allowUnattended = true).toJson("card")
        assertEquals("every_use", card.getString("approval"))
        assertFalse(card.getBoolean("allowUnattended"))

        val key = VaultPolicyDraft.defaultFor("api_key", "openai").toJson("api_key").getJSONObject("inject")
        assertEquals("""{"as":"header","name":"Authorization","format":"Bearer {value}"}""", key.toString())
    }

    @Test
    fun `turning an item off resends the rest of its policy unchanged`() {
        val item = VaultItem.from(
            JSONObject(
                """{"id":"i1","handle":"bank","kind":"login","backend":"local","audience":"bots","label":"Bank",
                   "origins":["https://bank.example.com"],"hosts":[],"inject":null,"tools":["browser_fill_secret"],
                   "effectiveTools":["browser_fill_secret"],"bots":["b1"],"approval":"allowed","effectiveApproval":"allowed",
                   "allowUnattended":true,"whenToUse":"work account","disabled":false,"field":null,
                   "updatedAt":"2026-11-21T10:00:00.000Z","createdAt":"2026-11-21T10:00:00.000Z"}""",
            ),
        )
        val policy = vaultPolicyBody("login", VaultPolicyDraft.of(item).copy(disabled = true)).getJSONObject("policy")
        assertEquals(
            JSONObject(
                """{"handle":"bank","label":"Bank","origins":["https://bank.example.com"],"hosts":[],
                   "tools":["browser_fill_secret"],"approval":"allowed","allowUnattended":true,"whenToUse":"work account",
                   "disabled":true,"inject":null,"bots":["b1"]}""",
            ).toString(),
            policy.toString(),
        )
    }

    @Test
    fun `new items wait until the primary backend can write`() {
        val starting = VaultOverview.from(
            JSONObject(
                """{"primaryBackend":"onepassword-connect","items":[],"unlinked":[],"kindDefaults":{"login":["browser_fill_secret"]},
                   "movableToOnePassword":2,"backends":[
                     {"name":"onepassword-connect","configured":true,"read":{"state":"ready"},
                      "write":{"state":"error","code":"starting","detail":"1Password is starting"},
                      "capabilities":{"create":true,"update":true,"delete":true,"reveal":true}},
                     {"name":"local","configured":true,"read":{"state":"ready"},"capabilities":{"create":true}}]}""",
            ),
        )
        assertFalse(starting.canCreate)
        assertEquals("1Password is starting", starting.createBlockedWhy)
        assertEquals(listOf("browser_fill_secret"), starting.kindDefaults["login"])

        val ready = VaultOverview.from(
            JSONObject("""{"primaryBackend":"local","backends":[{"name":"local","configured":true,"read":{"state":"ready"},"capabilities":{"create":true}}]}"""),
        )
        assertTrue(ready.canCreate)
    }
}
