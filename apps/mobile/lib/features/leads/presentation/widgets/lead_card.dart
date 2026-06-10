import 'package:flutter/material.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../core/util/format.dart';
import '../../../../core/widgets/badges.dart';
import '../../domain/lead.dart';
import '../lead_visuals.dart';

class LeadCard extends StatelessWidget {
  final Lead lead;
  final VoidCallback onTap;

  const LeadCard({super.key, required this.lead, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final subtitle = [
      if (lead.serviceInterest != null) lead.serviceInterest!,
      if (lead.targetCountry != null) lead.targetCountry!,
    ].join('  •  ');

    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: const BorderRadius.all(AppTokens.radiusLg),
        child: Padding(
          padding: const EdgeInsets.all(AppTokens.space4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      lead.fullName.isEmpty ? '(no name)' : lead.fullName,
                      style: t.titleMedium,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (lead.priority != null) ...[
                    const SizedBox(width: AppTokens.space2),
                    StatusBadge(
                      label: lead.priorityLabel,
                      color: leadPriorityColor(lead.priority),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: AppTokens.space1),
              Row(
                children: [
                  const Icon(Icons.phone_outlined,
                      size: 14, color: AppTokens.statusNeutral),
                  const SizedBox(width: 4),
                  Text(lead.phone, style: t.bodyMedium),
                ],
              ),
              if (subtitle.isNotEmpty) ...[
                const SizedBox(height: AppTokens.space1),
                Text(
                  subtitle,
                  style: t.bodySmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              const SizedBox(height: AppTokens.space3),
              Row(
                children: [
                  StatusBadge(
                    label: lead.statusLabel,
                    color: leadStatusColor(lead.status),
                  ),
                  const Spacer(),
                  Text(relativeTime(lead.createdAt), style: t.bodySmall),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
