@file:JvmName("MusicControls")

package dariuss.musiccontrols

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Build
import android.os.SystemClock
import android.util.Base64
import android.view.KeyEvent
import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeMethod

private const val BRIDGE = "dev.dariuss.musicbridge"
private const val ACTION_STATE = "$BRIDGE.STATE"
private const val ACTION_COMMAND = "$BRIDGE.COMMAND"

/** A signature permission of Music Bridge: only that app can send this plugin a state. */
private const val SEND_PERMISSION = "$BRIDGE.permission.SEND_STATE"

private val KEYS = mapOf(
    "playPause" to KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
    "next" to KeyEvent.KEYCODE_MEDIA_NEXT,
    "previous" to KeyEvent.KEYCODE_MEDIA_PREVIOUS,
)

@Volatile
private var appContext: Context? = null

@Volatile
private var receiver: BroadcastReceiver? = null

/** Last state from the Music Bridge app, with the time it arrived. */
@Volatile
private var bridgeState: Intent? = null

@Volatile
private var heardAt = 0L

@Volatile
private var artKey: String? = null

@Volatile
private var art: String? = null

private fun audio() = appContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

/** Sends a media key to whichever app is playing, like headphone buttons do. */
private fun pressKey(name: String?): Boolean {
    val code = KEYS[name] ?: return false
    val manager = audio() ?: return false
    val now = SystemClock.uptimeMillis()
    manager.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0))
    manager.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, code, 0))
    return true
}

private fun sendToBridge(command: String, position: Long = 0L): Boolean {
    val context = appContext ?: return false
    // Implicit: Discord cannot see Music Bridge on Android 11+, but its listener has a runtime receiver.
    context.sendBroadcast(Intent(ACTION_COMMAND).putExtra("command", command).putExtra("position", position))
    return true
}

private fun onState(intent: Intent) {
    bridgeState = intent
    heardAt = SystemClock.elapsedRealtime()
    val key = intent.getStringExtra("artKey")
    if (key != artKey) {
        artKey = key
        art = null
    }
    intent.getByteArrayExtra("art")?.let {
        art = "data:image/jpeg;base64," + Base64.encodeToString(it, Base64.NO_WRAP)
    }
}

/** The bridge state for JavaScript, with the position moved forward to now. Numbers are doubles for React Native. */
private fun stateMap(): Map<String, Any?>? {
    val intent = bridgeState ?: return null
    val now = SystemClock.elapsedRealtime()
    val playing = intent.getBooleanExtra("playing", false)
    val position = intent.getLongExtra("position", 0L)
    val updated = intent.getLongExtra("updated", 0L)
    val speed = intent.getFloatExtra("speed", 1f)
    val duration = intent.getLongExtra("duration", 0L)
    var current = if (playing && updated > 0) position + ((now - updated) * speed).toLong() else position
    if (duration > 0) current = current.coerceIn(0L, duration)
    return mapOf(
        "access" to intent.getBooleanExtra("access", false),
        "active" to intent.getBooleanExtra("active", false),
        "app" to intent.getStringExtra("app"),
        "package" to intent.getStringExtra("package"),
        "title" to intent.getStringExtra("title"),
        "artist" to intent.getStringExtra("artist"),
        "album" to intent.getStringExtra("album"),
        "playing" to playing,
        "position" to current.toDouble(),
        "duration" to duration.toDouble(),
        "actions" to intent.getLongExtra("actions", 0L).toDouble(),
        "canShuffle" to intent.getBooleanExtra("canShuffle", false),
        "canRepeat" to intent.getBooleanExtra("canRepeat", false),
        "shuffle" to intent.getBooleanExtra("shuffle", false),
        "repeat" to (intent.getStringExtra("repeat") ?: "off"),
        "artKey" to artKey,
        "artVersion" to intent.getIntExtra("artVersion", 0).toDouble(),
        "artUrl" to intent.getStringExtra("artUrl"),
        "age" to (now - heardAt).toDouble(),
    )
}

/**
 * Controls music from any app. With the Music Bridge app (which has notification access) it shows and
 * controls the current media session; without it, it falls back to media keys.
 */
val musicControls = plugin {
    start {
        withAppContext { context ->
            // Valenced hands over the context in attachBaseContext, before applicationContext exists.
            val app = context.applicationContext ?: context
            appContext = app
            if (receiver == null) {
                val listener = object : BroadcastReceiver() {
                    override fun onReceive(context: Context, intent: Intent) = onState(intent)
                }
                val filter = IntentFilter(ACTION_STATE)
                if (Build.VERSION.SDK_INT >= 33) {
                    app.registerReceiver(listener, filter, SEND_PERMISSION, null, Context.RECEIVER_EXPORTED)
                } else {
                    app.registerReceiver(listener, filter, SEND_PERMISSION, null)
                }
                receiver = listener
            }
            sendToBridge("request")
        }

        registerNativeMethod("musicControls.press") { args -> pressKey(args.firstOrNull() as? String) }

        registerNativeMethod("musicControls.playing") { audio()?.isMusicActive == true }

        registerNativeMethod("musicControls.state") { stateMap() }

        registerNativeMethod("musicControls.art") { art }

        registerNativeMethod("musicControls.command") { args ->
            val name = args.getOrNull(0) as? String ?: return@registerNativeMethod false
            val position = (args.getOrNull(1) as? Number)?.toLong() ?: 0L
            sendToBridge(name, position)
        }
    }

    stop {
        receiver?.let { runCatching { appContext?.unregisterReceiver(it) } }
        receiver = null
        bridgeState = null
        art = null
        artKey = null
    }
}
