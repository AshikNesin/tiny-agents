package groot.mobile.ui.brand

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/*
 * The app's icons: 24dp line icons, 2dp round strokes, drawn here so the app ships no icon
 * library. An icon takes the tint of the `Icon` that draws it.
 */

private fun circle(cx: Float, cy: Float, r: Float): String =
    "M${cx - r},${cy}a$r,$r 0 1,0 ${2 * r},0a$r,$r 0 1,0 ${-2 * r},0"

private fun rect(x: Float, y: Float, w: Float, h: Float, r: Float): String =
    "M${x + r},${y}h${w - 2 * r}a$r,$r 0 0,1 $r,${r}v${h - 2 * r}a$r,$r 0 0,1 ${-r},${r}h${-(w - 2 * r)}" +
        "a$r,$r 0 0,1 ${-r},${-r}v${-(h - 2 * r)}a$r,$r 0 0,1 $r,${-r}z"

private fun icon(name: String, vararg strokes: String, fills: List<String> = emptyList()): ImageVector =
    ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f).apply {
        for (data in strokes) {
            addPath(
                pathData = addPathNodes(data),
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        for (data in fills) addPath(pathData = addPathNodes(data), fill = SolidColor(Color.Black))
    }.build()

private const val BRAND_BUBBLE =
    "M7 3.5H15A6 6 0 0 1 16.662 3.735A3.625 3.625 0 0 0 20.765 7.838A6 6 0 0 1 21 9.5V12.5A6 6 0 0 1 15 18.5H10L4.5 22.5V17.954" +
        "A6 6 0 0 1 1 12.5V9.5A6 6 0 0 1 7 3.5ZM9 7.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-3 0V9A1.5 1.5 0 0 1 9 7.5z" +
        "M15 7.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-3 0V9a1.5 1.5 0 0 1 1.5-1.5z"

object AppIcons {
    /** The Tiny Agents mark: a chat bubble with eyes and an always-on dot (the web app's favicon without its tile). */
    val Brand by lazy {
        ImageVector.Builder(name = "tiny-agents", defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f).apply {
            addPath(pathData = addPathNodes(BRAND_BUBBLE), fill = SolidColor(Color.Black), pathFillType = PathFillType.EvenOdd)
            addPath(pathData = addPathNodes(circle(20.25f, 4.25f, 2.75f)), fill = SolidColor(Color.Black))
        }.build()
    }
    val Menu by lazy { icon("menu", "M4 8h16", "M4 16h10") }
    val Plus by lazy { icon("plus", "M5 12h14", "M12 5v14") }
    val ArrowUp by lazy { icon("arrow-up", "M12 19V5", "M5 12l7-7 7 7") }
    val ArrowLeft by lazy { icon("arrow-left", "M19 12H5", "M12 19l-7-7 7-7") }
    val Stop by lazy { icon("stop", fills = listOf(rect(6f, 6f, 12f, 12f, 2.5f))) }
    val Paperclip by lazy {
        icon("paperclip", "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48")
    }
    val Close by lazy { icon("close", "M18 6L6 18", "M6 6l12 12") }
    val Check by lazy { icon("check", "M20 6L9 17l-5-5") }
    val ChevronRight by lazy { icon("chevron-right", "M9 18l6-6-6-6") }
    val ChevronDown by lazy { icon("chevron-down", "M6 9l6 6 6-6") }
    val ChevronUp by lazy { icon("chevron-up", "M18 15l-6-6-6 6") }
    val ChevronLeft by lazy { icon("chevron-left", "M15 18l-6-6 6-6") }
    val More by lazy { icon("more", fills = listOf(circle(5f, 12f, 1.6f), circle(12f, 12f, 1.6f), circle(19f, 12f, 1.6f))) }
    val Search by lazy { icon("search", circle(11f, 11f, 7f), "M21 21l-4.3-4.3") }
    val Compose by lazy {
        icon(
            "compose",
            "M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",
            "M18.375 2.625a2.12 2.12 0 0 1 3 3L12.36 14.64a2 2 0 0 1-.85.5l-2.88.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.85z",
        )
    }
    val Settings by lazy {
        icon(
            "settings",
            "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
            circle(12f, 12f, 3f),
        )
    }
    val Globe by lazy {
        icon("globe", circle(12f, 12f, 10f), "M2 12h20", "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z")
    }
    val Monitor by lazy { icon("monitor", rect(2f, 3f, 20f, 14f, 2f), "M8 21h8", "M12 17v4") }
    val Terminal by lazy { icon("terminal", "M4 17l6-6-6-6", "M12 19h8") }
    val Clock by lazy { icon("clock", circle(12f, 12f, 10f), "M12 6v6l4 2") }
    val Tasks by lazy { icon("tasks", "M9 11l3 3L22 4", "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11") }
    val Layers by lazy {
        icon(
            "layers",
            "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z",
            "M22 17.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65",
            "M22 12.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65",
        )
    }
    val Book by lazy { icon("book", "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20") }
    val Plug by lazy { icon("plug", "M12 22v-5", "M9 8V2", "M15 8V2", "M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z") }
    val Key by lazy {
        icon("key", circle(7.5f, 15.5f, 5.5f), "M21 2l-9.6 9.6", "M15.5 7.5l2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4")
    }
    val Users by lazy {
        icon(
            "users",
            "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
            circle(9f, 7f, 4f),
            "M22 21v-2a4 4 0 0 0-3-3.87",
            "M16 3.13a4 4 0 0 1 0 7.75",
        )
    }
    val User by lazy { icon("user", "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", circle(12f, 7f, 4f)) }
    val Pin by lazy {
        icon(
            "pin",
            "M12 17v5",
            "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
        )
    }
    val Trash by lazy { icon("trash", "M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2") }
    val Pencil by lazy {
        icon(
            "pencil",
            "M21.17 6.81a2.82 2.82 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z",
            "M15 5l4 4",
        )
    }
    val Copy by lazy { icon("copy", rect(8f, 8f, 14f, 14f, 2f), "M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2") }
    val Refresh by lazy { icon("refresh", "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5") }
    val History by lazy { icon("history", "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M12 7v5l4 2") }
    val Zap by lazy {
        icon(
            "zap",
            "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
        )
    }
    val Image by lazy { icon("image", rect(3f, 3f, 18f, 18f, 2f), circle(9f, 9f, 2f), "M21 15l-3.09-3.09a2 2 0 0 0-2.82 0L6 21") }
    val File by lazy { icon("file", "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z", "M14 2v4a2 2 0 0 0 2 2h4") }
    val Download by lazy { icon("download", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3") }
    val Eye by lazy {
        icon("eye", "M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0z", circle(12f, 12f, 3f))
    }
    val Keyboard by lazy {
        icon("keyboard", rect(2f, 5f, 20f, 14f, 2f), "M6 9h.01", "M10 9h.01", "M14 9h.01", "M18 9h.01", "M6 13h.01", "M18 13h.01", "M10 13h4", "M8 16h8")
    }
    val Pointer by lazy { icon("pointer", "M4 4l7.07 16.97 2.51-7.39 7.39-2.51z") }
    val Play by lazy { icon("play", "M6 4l14 8-14 8z") }
    val Pause by lazy { icon("pause", rect(6f, 4f, 4f, 16f, 1f), rect(14f, 4f, 4f, 16f, 1f)) }
    val External by lazy { icon("external", "M15 3h6v6", "M10 14L21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6") }
    val LogOut by lazy { icon("log-out", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9") }
    val Bot by lazy { icon("bot", "M12 8V4H8", rect(4f, 8f, 16f, 12f, 2f), "M2 14h2", "M20 14h2", "M15 13v2", "M9 13v2") }
    val Lock by lazy { icon("lock", rect(3f, 11f, 18f, 11f, 2f), "M7 11V7a5 5 0 0 1 10 0v4") }
    val Alert by lazy { icon("alert", "M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z", "M12 9v4", "M12 17h.01") }
    val Info by lazy { icon("info", circle(12f, 12f, 10f), "M12 16v-4", "M12 8h.01") }
    val Ban by lazy { icon("ban", circle(12f, 12f, 10f), "M4.9 4.9l14.2 14.2") }
    val Maximize by lazy {
        icon("maximize", "M8 3H5a2 2 0 0 0-2 2v3", "M21 8V5a2 2 0 0 0-2-2h-3", "M3 16v3a2 2 0 0 0 2 2h3", "M16 21h3a2 2 0 0 0 2-2v-3")
    }
    val Grid by lazy { icon("grid", rect(3f, 3f, 7f, 7f, 1f), rect(14f, 3f, 7f, 7f, 1f), rect(14f, 14f, 7f, 7f, 1f), rect(3f, 14f, 7f, 7f, 1f)) }
    val Server by lazy { icon("server", rect(2f, 2f, 20f, 8f, 2f), rect(2f, 14f, 20f, 8f, 2f), "M6 6h.01", "M6 18h.01") }
    val Queue by lazy { icon("queue", "M15 10l5 5-5 5", "M4 4v7a4 4 0 0 0 4 4h12") }
    val Sparkle by lazy {
        icon(
            "sparkle",
            "M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z",
        )
    }
    val Code by lazy { icon("code", "M16 18l6-6-6-6", "M8 6l-6 6 6 6") }
    val Share by lazy { icon("share", "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8", "M16 6l-4-4-4 4", "M12 2v13") }
}
