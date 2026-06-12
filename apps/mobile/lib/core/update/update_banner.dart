import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../theme/tokens.dart';
import 'app_update.dart';

/// Slim, dismissible strip shown at the top of the shell when a newer build has
/// been published. Tapping "Update" opens the public downloads page. Renders
/// nothing while loading, on failure, when up to date, or once dismissed —
/// so it never gets in the way.
class UpdateBanner extends ConsumerStatefulWidget {
  const UpdateBanner({super.key});

  @override
  ConsumerState<UpdateBanner> createState() => _UpdateBannerState();
}

class _UpdateBannerState extends ConsumerState<UpdateBanner> {
  bool _dismissed = false;

  @override
  Widget build(BuildContext context) {
    if (_dismissed) return const SizedBox.shrink();
    final status = ref.watch(appUpdateProvider).valueOrNull;
    if (status == null || !status.updateAvailable) {
      return const SizedBox.shrink();
    }

    return Material(
      color: AppTokens.brandNavy,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 8, 6, 8),
        child: Row(
          children: [
            const Icon(Icons.system_update, color: Colors.white, size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'New version ${status.latestVersion ?? ''} available',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            TextButton(
              onPressed: () => launchUrl(
                Uri.parse(downloadsPageUrl),
                mode: LaunchMode.externalApplication,
              ),
              style: TextButton.styleFrom(
                foregroundColor: Colors.white,
                visualDensity: VisualDensity.compact,
              ),
              child: const Text('Update',
                  style: TextStyle(fontWeight: FontWeight.w700)),
            ),
            IconButton(
              tooltip: 'Dismiss',
              onPressed: () => setState(() => _dismissed = true),
              icon: const Icon(Icons.close, color: Colors.white70, size: 18),
              visualDensity: VisualDensity.compact,
            ),
          ],
        ),
      ),
    );
  }
}
