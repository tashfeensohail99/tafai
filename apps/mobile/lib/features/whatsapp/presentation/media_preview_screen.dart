import 'dart:io';

import 'package:flutter/material.dart';

import '../../../core/theme/tokens.dart';

/// WhatsApp-style "confirm before send" preview for a picked attachment.
///
/// Pops with the caption string (possibly empty) when the user taps Send, or
/// `null` if they back out / cancel — so the caller can tell "send" from
/// "cancelled" even when the caption is blank.
class MediaPreviewScreen extends StatefulWidget {
  final String filePath;
  final String fileName;
  final bool isImage;
  final String contactName;

  const MediaPreviewScreen({
    super.key,
    required this.filePath,
    required this.fileName,
    required this.isImage,
    required this.contactName,
  });

  @override
  State<MediaPreviewScreen> createState() => _MediaPreviewScreenState();
}

class _MediaPreviewScreenState extends State<MediaPreviewScreen> {
  final _caption = TextEditingController();

  @override
  void dispose() {
    _caption.dispose();
    super.dispose();
  }

  void _send() => Navigator.of(context).pop(_caption.text.trim());

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0B141A),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        foregroundColor: Colors.white,
        elevation: 0,
        systemOverlayStyle: null,
        leading: IconButton(
          icon: const Icon(Icons.close, color: Colors.white),
          onPressed: () => Navigator.of(context).pop(), // null = cancel
        ),
        title: Text(
          widget.contactName,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: Colors.white, fontSize: 16),
        ),
      ),
      body: Column(
        children: [
          // ── Preview ────────────────────────────────────────────────────
          Expanded(
            child: Center(
              child: widget.isImage
                  ? InteractiveViewer(
                      minScale: 0.8,
                      maxScale: 4,
                      child: Image.file(
                        File(widget.filePath),
                        fit: BoxFit.contain,
                        errorBuilder: (_, __, ___) =>
                            _FileChip(name: widget.fileName),
                      ),
                    )
                  : _FileChip(name: widget.fileName),
            ),
          ),

          // ── Caption + send ─────────────────────────────────────────────
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppTokens.space3, AppTokens.space2, AppTokens.space3, AppTokens.space3),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: Container(
                      decoration: BoxDecoration(
                        color: const Color(0xFF1F2C34),
                        borderRadius: BorderRadius.circular(24),
                      ),
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: TextField(
                        controller: _caption,
                        minLines: 1,
                        maxLines: 4,
                        textCapitalization: TextCapitalization.sentences,
                        style: const TextStyle(color: Colors.white, fontSize: 15),
                        cursorColor: Colors.white,
                        decoration: const InputDecoration(
                          hintText: 'Add a caption…',
                          hintStyle: TextStyle(color: Color(0xFF8FA3AD)),
                          border: InputBorder.none,
                          isDense: true,
                          contentPadding: EdgeInsets.symmetric(vertical: 12),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppTokens.space2),
                  Material(
                    color: AppTokens.brandNavy,
                    shape: const CircleBorder(),
                    child: InkWell(
                      onTap: _send,
                      customBorder: const CircleBorder(),
                      child: const SizedBox(
                        width: 52,
                        height: 52,
                        child: Icon(Icons.send, color: Colors.white, size: 22),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FileChip extends StatelessWidget {
  final String name;
  const _FileChip({required this.name});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.all(AppTokens.space6),
      padding: const EdgeInsets.all(AppTokens.space5),
      decoration: BoxDecoration(
        color: const Color(0xFF1F2C34),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.insert_drive_file_outlined,
              color: Colors.white, size: 56),
          const SizedBox(height: AppTokens.space3),
          Text(
            name,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white, fontSize: 14),
          ),
        ],
      ),
    );
  }
}
