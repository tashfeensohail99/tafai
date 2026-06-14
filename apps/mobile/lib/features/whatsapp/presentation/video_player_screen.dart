import 'package:chewie/chewie.dart';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../../../core/util/launchers.dart';

/// Full-screen in-app video player for a chat attachment, backed by a signed
/// URL. Uses video_player (ExoPlayer → Flutter texture) + chewie for the
/// play / seek / fullscreen controls. If playback fails on a given device,
/// the "Open in browser" action is the fallback.
class VideoPlayerScreen extends StatefulWidget {
  final String url;
  final String title;
  const VideoPlayerScreen({super.key, required this.url, this.title = 'Video'});

  @override
  State<VideoPlayerScreen> createState() => _VideoPlayerScreenState();
}

class _VideoPlayerScreenState extends State<VideoPlayerScreen> {
  VideoPlayerController? _video;
  ChewieController? _chewie;
  bool _error = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      final video = VideoPlayerController.networkUrl(Uri.parse(widget.url));
      await video.initialize();
      final chewie = ChewieController(
        videoPlayerController: video,
        autoPlay: true,
        looping: false,
        allowFullScreen: true,
        aspectRatio:
            video.value.aspectRatio == 0 ? 16 / 9 : video.value.aspectRatio,
        materialProgressColors: ChewieProgressColors(
          playedColor: Colors.white,
          handleColor: Colors.white,
          bufferedColor: Colors.white24,
          backgroundColor: Colors.white10,
        ),
      );
      if (!mounted) {
        await video.dispose();
        chewie.dispose();
        return;
      }
      setState(() {
        _video = video;
        _chewie = chewie;
      });
    } catch (_) {
      if (mounted) setState(() => _error = true);
    }
  }

  @override
  void dispose() {
    _chewie?.dispose();
    _video?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        title: Text(widget.title, overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(
            tooltip: 'Open in browser',
            icon: const Icon(Icons.open_in_new),
            onPressed: () => openExternalUrl(widget.url),
          ),
        ],
      ),
      body: Center(
        child: _error
            ? Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline,
                        color: Colors.white54, size: 40),
                    const SizedBox(height: 12),
                    const Text('Could not play the video here.',
                        style: TextStyle(color: Colors.white70)),
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      onPressed: () => openExternalUrl(widget.url),
                      icon: const Icon(Icons.open_in_new, size: 18),
                      label: const Text('Open in browser'),
                    ),
                  ],
                ),
              )
            : _chewie != null
                ? Chewie(controller: _chewie!)
                : const CircularProgressIndicator(color: Colors.white),
      ),
    );
  }
}
