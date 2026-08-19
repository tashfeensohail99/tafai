import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Selected bottom-nav tab index PER shell, keyed by shell id
/// ('sales','finance','client','processing'). A family — NOT one global int —
/// so each role's shell keeps its own tab state and can never clobber another's
/// (a shared index could also push an out-of-range value into a different
/// shell's IndexedStack and crash it). Exposed so deep-links (e.g. tapping a
/// notification) can switch tabs from anywhere.
///
/// Sales tabs: 0=Home 1=Leads 2=Follow-ups 3=Appointments 4=Chat 5=Calls.
final shellIndexProvider =
    StateProvider.family<int, String>((ref, shellId) => 0);
