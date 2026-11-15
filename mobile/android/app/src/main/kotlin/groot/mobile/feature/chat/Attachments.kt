package groot.mobile.feature.chat

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import groot.kit.theme.S
import groot.mobile.data.api.AttachmentRef
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.LocalContainer
import groot.mobile.ui.components.fileSize

/** An uploaded image, loaded with the session's token; null until it arrives. */
@Composable
fun rememberUploadImage(uploadId: String): Bitmap? {
    val images = LocalContainer.current.images
    val bitmap by produceState(initialValue = images.cached(uploadId), uploadId) {
        if (value == null) value = images.load(uploadId)
    }
    return bitmap
}

/** The attachments of a message: images as thumbnails, files as chips. Tapping one opens or saves it. */
@Composable
fun MessageAttachments(
    attachments: List<AttachmentRef>,
    onOpenImage: (AttachmentRef) -> Unit,
    onSaveFile: (AttachmentRef) -> Unit,
    modifier: Modifier = Modifier,
    alignEnd: Boolean = false,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(S.xs),
        horizontalAlignment = if (alignEnd) Alignment.End else Alignment.Start,
    ) {
        for (ref in attachments) {
            if (ref.isImage) {
                val ratio = if (ref.width != null && ref.height != null && ref.height > 0) ref.width.toFloat() / ref.height else 1f
                val bitmap = rememberUploadImage(ref.uploadId)
                Box(
                    modifier = Modifier
                        .widthIn(max = Dims.imagePreviewMax)
                        .heightIn(max = Dims.imagePreviewMax)
                        .aspectRatio(ratio.coerceIn(0.5f, 2.5f))
                        .clip(RoundedCornerShape(Dims.cardRadius))
                        .background(MaterialTheme.colorScheme.surfaceContainer)
                        .clickable(role = Role.Image, onClickLabel = "Open ${ref.name}") { onOpenImage(ref) },
                    contentAlignment = Alignment.Center,
                ) {
                    if (bitmap != null) {
                        Image(bitmap.asImageBitmap(), contentDescription = ref.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    } else {
                        AppIcon(AppIcons.Image, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            } else {
                FileChip(name = ref.name, detail = fileSize(ref.size), onClick = { onSaveFile(ref) }, trailingIcon = true)
            }
        }
    }
}

@Composable
fun FileChip(name: String, detail: String, onClick: (() -> Unit)?, modifier: Modifier = Modifier, trailingIcon: Boolean = false) {
    Row(
        modifier = modifier
            .widthIn(max = Dims.bubbleMaxWidth)
            .clip(RoundedCornerShape(Dims.fieldRadius))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClickLabel = "Save $name", onClick = onClick) else Modifier)
            .padding(horizontal = S.md, vertical = S.sm),
        horizontalArrangement = Arrangement.spacedBy(S.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AppIcon(AppIcons.File, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.weight(1f, fill = false)) {
            Text(name, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
        if (trailingIcon) AppIcon(AppIcons.Download, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, size = Dims.iconSmall)
    }
}

/** A file staged in the composer: its name, an upload spinner or error, and a remove button. */
@Composable
fun StagedChip(upload: StagedUpload, onRemove: () -> Unit) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(Dims.fieldRadius))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .padding(start = S.md),
        horizontalArrangement = Arrangement.spacedBy(S.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (upload.uploading) {
            CircularProgressIndicator(Modifier.size(Dims.iconSmall), color = MaterialTheme.colorScheme.onSurfaceVariant, strokeWidth = Dims.stroke)
        } else {
            AppIcon(
                if (upload.error != null) AppIcons.Alert else if (upload.file.mimeType.startsWith("image/")) AppIcons.Image else AppIcons.File,
                contentDescription = null,
                tint = if (upload.error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                size = Dims.iconSmall,
            )
        }
        Column(Modifier.widthIn(max = Dims.thumbnail * 2)) {
            Text(upload.file.name, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (upload.error != null) {
                Text(upload.error, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        IconBtn(AppIcons.Close, "Remove ${upload.file.name}", onRemove, iconSize = Dims.iconSmall)
    }
}

/** An image full screen, with a way to save it. */
@Composable
fun ImageViewer(ref: AttachmentRef, onSave: () -> Unit, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).systemBarsPadding()) {
            val bitmap = rememberUploadImage(ref.uploadId)
            if (bitmap != null) {
                Image(bitmap.asImageBitmap(), contentDescription = ref.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            } else {
                CircularProgressIndicator(Modifier.align(Alignment.Center).size(Dims.iconLarge), color = MaterialTheme.colorScheme.onSurfaceVariant, strokeWidth = Dims.stroke)
            }
            Row(Modifier.fillMaxWidth().padding(S.sm), horizontalArrangement = Arrangement.SpaceBetween) {
                IconBtn(AppIcons.Close, "Close", onDismiss, background = MaterialTheme.colorScheme.surfaceContainer)
                IconBtn(AppIcons.Download, "Save to Downloads", onSave, background = MaterialTheme.colorScheme.surfaceContainer)
            }
        }
    }
}
