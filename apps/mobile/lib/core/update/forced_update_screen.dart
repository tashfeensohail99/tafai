import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../theme/tokens.dart';
import 'app_update.dart';

/// Full-screen, NON-dismissible "update required" gate. The shell renders this
/// instead of the app whenever a newer build has been published, so the whole
/// team is always on the latest version (mandatory updates). The Update button
/// downloads the correct APK for the device's CPU — arm64-v8a for 64-bit
/// phones, armeabi-v7a for older 32-bit phones — so it installs on either.
class ForcedUpdateScreen extends ConsumerStatefulWidget {
  final String? latestVersion;
  const ForcedUpdateScreen({super.key, this.latestVersion});

  @override
  ConsumerState<ForcedUpdateScreen> createState() => _ForcedUpdateScreenState();
}

class _ForcedUpdateScreenState extends ConsumerState<ForcedUpdateScreen> {
  bool _opening = false;

  Future<void> _update() async {
    if (_opening) return;
    setState(() => _opening = true);
    try {
      final url = await apkUrlForDevice();
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    } catch (_) {
      // Fall back to the downloads page (lists both 64-bit and 32-bit builds).
      await launchUrl(Uri.parse(downloadsPageUrl),
          mode: LaunchMode.externalApplication);
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // canPop:false → Android back button can't dismiss the gate.
    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: AppTokens.brandNavy,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(28),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.system_update,
                      color: Colors.white, size: 64),
                  const SizedBox(height: 20),
                  const Text(
                    'Update required',
                    style: TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'A newer version${widget.latestVersion != null ? ' (${widget.latestVersion})' : ''} is available. '
                    'Please update to continue — it takes a moment and keeps everyone on the latest fixes.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        color: Colors.white70, fontSize: 14, height: 1.4),
                  ),
                  const SizedBox(height: 28),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _opening ? null : _update,
                      style: FilledButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: AppTokens.brandNavy,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      icon: _opening
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.download),
                      label: const Text('Update now',
                          style: TextStyle(
                              fontWeight: FontWeight.w700, fontSize: 15)),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: () => launchUrl(Uri.parse(downloadsPageUrl),
                        mode: LaunchMode.externalApplication),
                    child: const Text(
                      'Trouble installing? Open the downloads page',
                      style: TextStyle(color: Colors.white60, fontSize: 12.5),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
