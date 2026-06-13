import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tafsheen_mobile/core/widgets/app_states.dart';

/// Lightweight smoke tests for the shared state widgets — they must render
/// their content without throwing. (SkeletonList is intentionally excluded:
/// its shimmer runs a repeating animation that leaves a pending ticker at
/// test teardown.)
void main() {
  testWidgets('EmptyView shows its title and message', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: EmptyView(
            title: 'No leads yet',
            message: 'Leads assigned to you will appear here.',
          ),
        ),
      ),
    );
    expect(find.text('No leads yet'), findsOneWidget);
    expect(find.text('Leads assigned to you will appear here.'), findsOneWidget);
  });

  testWidgets('ErrorView offers a retry action when given one', (tester) async {
    var retried = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ErrorView(error: 'boom', onRetry: () => retried = true),
        ),
      ),
    );
    expect(find.text('Try again'), findsOneWidget);
    await tester.tap(find.text('Try again'));
    expect(retried, isTrue);
  });

  testWidgets('ForbiddenView renders the no-access state', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: ForbiddenView())),
    );
    expect(find.text('No access'), findsOneWidget);
  });
}
