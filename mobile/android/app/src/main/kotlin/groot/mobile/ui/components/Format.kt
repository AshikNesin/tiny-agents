package groot.mobile.ui.components

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

fun relativeTime(epochMs: Long, now: Long = System.currentTimeMillis()): String {
    val seconds = (now - epochMs) / 1000
    return when {
        epochMs <= 0L -> ""
        seconds < 60 -> "now"
        seconds < 3_600 -> "${seconds / 60}m"
        seconds < 86_400 -> "${seconds / 3_600}h"
        seconds < 7 * 86_400 -> "${seconds / 86_400}d"
        else -> shortDate(epochMs)
    }
}

private fun shortDateFormat(): DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())
private fun dateTimeFormat(): DateTimeFormatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(Locale.getDefault())

fun shortDate(epochMs: Long, zone: ZoneId = ZoneId.systemDefault()): String =
    shortDateFormat().format(Instant.ofEpochMilli(epochMs).atZone(zone))

fun dateTime(epochMs: Long, zone: ZoneId = ZoneId.systemDefault()): String =
    dateTimeFormat().format(Instant.ofEpochMilli(epochMs).atZone(zone))

fun fileSize(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "${bytes / 1024} KB"
    else -> String.format(Locale.ROOT, "%.1f MB", bytes / (1024.0 * 1024.0))
}
