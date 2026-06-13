import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_pdfview/flutter_pdfview.dart';
import 'package:path_provider/path_provider.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/launchers.dart';

/// In-app PDF viewer for agreement documents. The PDF lives behind a short-lived
/// signed URL, so we download the bytes to a temp file and render them natively
/// (pinch-zoom, page swipe) rather than launching an external browser. Falls
/// back to "Open in browser" if the download or render fails.
class PdfViewerScreen extends StatefulWidget {
  final String url;
  final String title;
  const PdfViewerScreen({super.key, required this.url, this.title = 'Document'});

  @override
  State<PdfViewerScreen> createState() => _PdfViewerScreenState();
}

class _PdfViewerScreenState extends State<PdfViewerScreen> {
  String? _path;
  String? _error;
  int _pages = 0;
  int _current = 0;

  @override
  void initState() {
    super.initState();
    _download();
  }

  Future<void> _download() async {
    setState(() {
      _error = null;
      _path = null;
    });
    try {
      // Plain Dio — no app interceptors/auth. The signed URL carries its own
      // authorization, and our bearer token must never be sent to storage.
      final res = await Dio().get<List<int>>(
        widget.url,
        options: Options(responseType: ResponseType.bytes),
      );
      final dir = await getTemporaryDirectory();
      final file = File(
        '${dir.path}/agreement_${DateTime.now().millisecondsSinceEpoch}.pdf',
      );
      await file.writeAsBytes(res.data ?? const <int>[]);
      if (mounted) setState(() => _path = file.path);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the PDF.');
    }
  }

  @override
  Widget build(BuildContext context) {
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
          ? _ErrorView(onRetry: _download, onOpenExternal: () => openExternalUrl(widget.url))
          : _path == null
              ? const Center(child: CircularProgressIndicator())
              : PDFView(
                  filePath: _path!,
                  swipeHorizontal: false,
                  onError: (_) {
                    if (mounted) {
                      setState(() => _error = 'Could not display the PDF.');
                    }
                  },
                  onRender: (pages) {
                    if (mounted) setState(() => _pages = pages ?? 0);
                  },
                  onPageChanged: (page, total) {
                    if (mounted) setState(() => _current = page ?? 0);
                  },
                ),
      bottomNavigationBar: (_error == null && _path != null && _pages > 0)
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: AppTokens.space2),
                child: Center(
                  child: Text(
                    'Page ${_current + 1} of $_pages',
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
