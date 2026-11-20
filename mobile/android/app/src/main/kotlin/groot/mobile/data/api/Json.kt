package groot.mobile.data.api

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

internal fun JSONObject.stringOrNull(key: String): String? =
    if (!has(key) || isNull(key)) null else opt(key)?.toString()

internal fun JSONObject.string(key: String, fallback: String = ""): String = stringOrNull(key) ?: fallback

internal fun JSONObject.bool(key: String, fallback: Boolean = false): Boolean =
    if (!has(key) || isNull(key)) fallback else optBoolean(key, fallback)

internal fun JSONObject.boolOrNull(key: String): Boolean? =
    if (!has(key) || isNull(key)) null else opt(key) as? Boolean

internal fun JSONObject.intOrNull(key: String): Int? =
    if (!has(key) || isNull(key)) null else (opt(key) as? Number)?.toInt()

internal fun JSONObject.int(key: String, fallback: Int = 0): Int = intOrNull(key) ?: fallback

internal fun JSONObject.longOrNull(key: String): Long? =
    if (!has(key) || isNull(key)) null else (opt(key) as? Number)?.toLong()

internal fun JSONObject.long(key: String, fallback: Long = 0L): Long = longOrNull(key) ?: fallback

internal fun JSONObject.doubleOrNull(key: String): Double? =
    if (!has(key) || isNull(key)) null else (opt(key) as? Number)?.toDouble()

internal fun JSONObject.objOrNull(key: String): JSONObject? = if (isNull(key)) null else optJSONObject(key)

internal fun JSONObject.arr(key: String): JSONArray = (if (isNull(key)) null else optJSONArray(key)) ?: JSONArray()

internal fun JSONObject.instantOrNull(key: String): Long? = stringOrNull(key)?.let(::parseInstant)

internal fun JSONObject.instant(key: String): Long = instantOrNull(key) ?: 0L

internal fun parseInstant(text: String): Long? = runCatching { Instant.parse(text).toEpochMilli() }.getOrNull()

internal inline fun <T> JSONArray.mapObjects(transform: (JSONObject) -> T): List<T> {
    val out = ArrayList<T>(length())
    for (i in 0 until length()) optJSONObject(i)?.let { out.add(transform(it)) }
    return out
}

internal fun JSONArray.strings(): List<String> {
    val out = ArrayList<String>(length())
    for (i in 0 until length()) if (!isNull(i)) out.add(get(i).toString())
    return out
}

internal fun JSONArray.ints(): List<Int> {
    val out = ArrayList<Int>(length())
    for (i in 0 until length()) (opt(i) as? Number)?.let { out.add(it.toInt()) }
    return out
}

internal fun JSONObject.stringMap(key: String): Map<String, String> {
    val obj = objOrNull(key) ?: return emptyMap()
    val out = LinkedHashMap<String, String>()
    for (name in obj.keys()) obj.stringOrNull(name)?.let { out[name] = it }
    return out
}

internal fun JSONObject.toPlainMap(): Map<String, Any?> {
    val out = LinkedHashMap<String, Any?>()
    for (name in keys()) out[name] = plain(opt(name))
    return out
}

private fun plain(value: Any?): Any? = when (value) {
    null, JSONObject.NULL -> null
    is JSONObject -> value.toPlainMap()
    is JSONArray -> (0 until value.length()).map { plain(value.opt(it)) }
    else -> value
}

fun jsonOf(vararg pairs: Pair<String, Any?>): JSONObject {
    val out = JSONObject()
    for ((key, value) in pairs) out.put(key, wrap(value))
    return out
}

fun jsonOfNotNull(vararg pairs: Pair<String, Any?>): JSONObject {
    val out = JSONObject()
    for ((key, value) in pairs) if (value != null) out.put(key, wrap(value))
    return out
}

internal fun wrap(value: Any?): Any = when (value) {
    null -> JSONObject.NULL
    is JSONObject, is JSONArray -> value
    is Map<*, *> -> JSONObject().also { obj -> value.forEach { (k, v) -> obj.put(k.toString(), wrap(v)) } }
    is Iterable<*> -> JSONArray().also { array -> value.forEach { array.put(wrap(it)) } }
    else -> value
}
