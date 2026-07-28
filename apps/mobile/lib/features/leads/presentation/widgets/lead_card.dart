import 'package:flutter/material.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../core/util/format.dart';
import '../../../../core/widgets/premium_ui.dart';
import '../../../whatsapp/presentation/disposition_sheet.dart';
import '../../domain/lead.dart';
import '../lead_visuals.dart';

class LeadCard extends StatelessWidget {
  final Lead lead;
  final VoidCallback onTap;

  const LeadCard({super.key, required this.lead, required this.onTap});

  String _initials(String name) {
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final statusColor = leadStatusColor(lead.status);
    final priorityColor = leadPriorityColor(lead.priority);

    final subtitle = [
      if (lead.serviceInterest != null) lead.serviceInterest!,
      if (lead.targetCountry != null) lead.targetCountry!,
    ].join('  ·  ');

    return Container(
      decoration: const BoxDecoration(
        borderRadius: BorderRadius.all(AppTokens.radiusCard),
        boxShadow: AppTokens.cardShadow,
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.white,
        child: InkWell(
          onTap: onTap,
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // ── left accent strip ────────────────────────────────────────
                Container(width: 4, color: statusColor),

                // ── avatar + body ────────────────────────────────────────────
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 14, 0, 14),
                  child: Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(
                      color: AppTokens.avatarTintLight,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      _initials(lead.fullName),
                      style: const TextStyle(
                        color: AppTokens.avatarFg,
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                      ),
                    ),
                  ),
                ),

                // ── text block ───────────────────────────────────────────────
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 12, 8, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        // name row
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Text(
                                lead.fullName.isEmpty
                                    ? '(no name)'
                                    : lead.fullName,
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700,
                                  color: AppTokens.textPrimaryLight,
                                  letterSpacing: -0.3,
                                  height: 1.2,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (lead.priority != null) ...[
                              const SizedBox(width: 6),
                              PremiumStatusBadge(
                                label: lead.priorityLabel,
                                color: priorityColor,
                                compact: true,
                              ),
                            ],
                          ],
                        ),

                        const SizedBox(height: 4),

                        // phone
                        Row(
                          children: [
                            const Icon(Icons.phone_outlined,
                                size: 13,
                                color: AppTokens.textMutedLight),
                            const SizedBox(width: 4),
                            Text(
                              lead.phone,
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppTokens.textMutedLight,
                              ),
                            ),
                          ],
                        ),

                        if (subtitle.isNotEmpty) ...[
                          const SizedBox(height: 3),
                          Text(
                            subtitle,
                            style: const TextStyle(
                              fontSize: 11,
                              color: AppTokens.textMutedLight,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],

                        const SizedBox(height: 8),

                        // status row
                        Row(
                          children: [
                            PremiumStatusBadge(
                              label: lead.statusLabel,
                              color: statusColor,
                              compact: true,
                            ),
                            // WhatsApp CRM disposition — the single source of
                            // truth, shown only when set.
                            if (lead.disposition != null) ...[
                              const SizedBox(width: 6),
                              PremiumStatusBadge(
                                label: kDispositions[lead.disposition!] ??
                                    lead.disposition!,
                                color: dispositionColor(lead.disposition),
                                compact: true,
                              ),
                            ],
                            const Spacer(),
                            Text(
                              relativeTime(lead.updatedAt),
                              style: const TextStyle(
                                fontSize: 11,
                                color: AppTokens.textMutedLight,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
