import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:pdfx/pdfx.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/launchers.dart';

/// In-app PDF viewer for agreement documents. The PDF lives behind a short-lived
/// signed URL, so we download the bytes and render them with **pdfx** — which
/// rasterises pages through Android's native PdfRenderer into a Flutter texture
/// (pinch-zoom + scroll). We deliberately do NOT use flutter_pdfview: it paints
/// into a SurfaceView that some Android skins (Xiaomi / HyperOS on Android 15)
/// composite as hidden, so the page count loaded but the page never appeared.
/// Falls back to "Open in browser" if the download or render fails.
class PdfViewerScreen extends StatefulWidget {
  final String url;
  final String title;
  const PdfViewerScreen({super.key, required this.url, this.title = 'Document'});

  @override
  State<PdfViewerScreen> createState() => _PdfViewerScreenState();
}

class _PdfViewerScreenState extends State<PdfViewerScreen> {
  PdfControllerPinch? _controller;
  String? _error;
  int _pages = 0;
  int _current = 1;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    // Tear down any previous controller (e.g. on Retry) before refetching.
    final previous = _controller;
    setState(() {
      _error = null;
      _controller = null;
      _pages = 0;
      _current = 1;
    });
    previous?.dispose();
    try {
      // Plain Dio — no app interceptors/auth. The signed URL carries its own
      // authorization, and our bearer token must never be sent to storage.
      final res = await Dio().get<List<int>>(
        widget.url,
        options: Options(responseType: ResponseType.bytes),
      );
      final bytes = Uint8List.fromList(res.data ?? const <int>[]);
      final controller = PdfControllerPinch(
        document: PdfDocument.openData(bytes),
      );
      if (!mounted) {
        controller.dispose();
        return;
      }
      setState(() => _controller = controller);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the PDF.');
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title, overflow: TextOverflow.ellipsis),
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        actions: [
          IconButton(
            tooltip: 'Open in browser',
            icon: const Icon(Icons.open_in_new),
            onPressed: () => openExternalUrl(widget.url),
          ),
        ],
      ),
      body: _error != null
          ? _ErrorView(
              onRetry: _load,
              onOpenExternal: () => openExternalUrl(widget.url),
            )
          : controller == null
              ? const Center(child: CircularProgressIndicator())
              : PdfViewPinch(
                  controller: controller,
                  onDocumentLoaded: (doc) {
                    if (mounted) setState(() => _pages = doc.pagesCount);
                  },
                  onDocumentError: (_) {
                    if (mounted) {
                      setState(() => _error = 'Could not display the PDF.');
                    }
                  },
                  onPageChanged: (page) {
                    if (mounted) setState(() => _current = page);
                  },
                ),
      bottomNavigationBar: (_error == null && controller != null && _pages > 0)
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: AppTokens.space2),
                child: Center(
                  child: Text(
                    'Page $_current of $_pages',
                    style: const TextStyle(
                        fontSize: 12, color: AppTokens.textMutedLight),
                  ),
                ),
              ),
            )
          : null,
    );
  }
}

class _ErrorView extends StatelessWidget {
  final VoidCallback onRetry;
  final VoidCallback onOpenExternal;
  const _ErrorView({required this.onRetry, required this.onOpenExternal});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.space5),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.picture_as_pdf_outlined,
                size: 40, color: AppTokens.textMutedLight),
            const SizedBox(height: AppTokens.space3),
            const Text('Could not load the PDF.'),
            const SizedBox(height: AppTokens.space4),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
                const SizedBox(width: AppTokens.space3),
                FilledButton(
                    onPressed: onOpenExternal,
                    child: const Text('Open in browser')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
