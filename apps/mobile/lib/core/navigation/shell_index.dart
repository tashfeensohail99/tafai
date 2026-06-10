import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The AppShell's selected bottom-nav tab index. Exposed as a provider so
/// deep-links (e.g. tapping a notification) can switch tabs from anywhere.
/// 0=Home 1=Leads 2=Follow-ups 3=Appointments 4=Chat.
final shellIndexProvider = StateProvider<int>((ref) => 0);
