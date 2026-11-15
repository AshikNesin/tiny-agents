package groot.mobile.data

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import groot.mobile.data.api.AttachmentRef
import groot.mobile.data.api.TinyAgentsApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException

/** A file the owner picked: what the composer shows before and while it uploads. */
data class PickedFile(val uri: Uri, val name: String, val mimeType: String, val size: Long)

/** Moves files between the device and the server: picked documents up, attachments down. */
class FileActions(private val context: Context, private val api: TinyAgentsApi) {
    /** Name, type and size of a picked document. */
    suspend fun describe(uri: Uri): PickedFile = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        var name = uri.lastPathSegment ?: "file"
        var size = -1L
        runCatching {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { index ->
                        cursor.getString(index)?.let { name = it }
                    }
                    cursor.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 }?.let { index ->
                        if (!cursor.isNull(index)) size = cursor.getLong(index)
                    }
                }
            }
        }
        val mimeType = resolver.getType(uri)
            ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
            ?: "application/octet-stream"
        PickedFile(uri, name, mimeType, size)
    }

    /** Upload a picked file; the server caps a file at 25 MB. */
    suspend fun upload(file: PickedFile): AttachmentRef {
        if (file.size > MAX_UPLOAD_BYTES) throw IOException("Files can be up to 25 MB.")
        // A provider that does not report a size is read once to learn it: the server needs the length up front.
        val length = if (file.size >= 0) {
            file.size
        } else {
            withContext(Dispatchers.IO) { context.contentResolver.openInputStream(file.uri)?.use { it.readBytes().size.toLong() } ?: 0L }
        }
        if (length > MAX_UPLOAD_BYTES) throw IOException("Files can be up to 25 MB.")
        return api.upload(file.name, file.mimeType, length) {
            context.contentResolver.openInputStream(file.uri) ?: throw IOException("Could not read ${file.name}.")
        }
    }

    /** Save an attachment to the device's Downloads folder; returns its content Uri, to open or share. */
    suspend fun saveToDownloads(ref: AttachmentRef): Uri = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, ref.name)
            put(MediaStore.Downloads.MIME_TYPE, ref.mimeType)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IOException("Could not create the file.")
        try {
            api.uploadContent(ref.uploadId).use { response ->
                resolver.openOutputStream(uri)?.use { out -> response.body.byteStream().copyTo(out) }
                    ?: throw IOException("Could not write the file.")
            }
            resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            uri
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
    }

    companion object {
        const val MAX_UPLOAD_BYTES = 25L * 1024 * 1024
        const val MAX_ATTACHMENTS = 10
    }
}
