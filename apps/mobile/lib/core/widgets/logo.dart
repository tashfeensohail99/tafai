import 'package:flutter/material.dart';
import 'dart:math' as math;

/// Renders the Tashfeen Immigration Solutions brand mark.
///
/// [size] controls the height of the T icon. Text and overall proportions
/// scale accordingly. Set [showText] to false for icon-only usage.
class TashfeenLogo extends StatelessWidget {
  final double size;
  final bool showText;
  final Color? textColor;

  const TashfeenLogo({
    super.key,
    this.size = 72,
    this.showText = true,
    this.textColor,
  });

  @override
  Widget build(BuildContext context) {
    final labelColor = textColor ?? const Color(0xFF9CA3AF);
    final iconW = size * 0.75;
    final iconH = size;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        CustomPaint(
          size: Size(iconW, iconH),
          painter: _TLogoPainter(),
        ),
        if (showText) ...[
          SizedBox(height: size * 0.18),
          Text(
            'TASHFEEN',
            style: TextStyle(
              fontSize: size * 0.30,
              fontWeight: FontWeight.w800,
              letterSpacing: size * 0.06,
              color: labelColor,
              height: 1.0,
            ),
          ),
          SizedBox(height: size * 0.04),
          Text(
            'IMMIGRATION SOLUTIONS',
            style: TextStyle(
              fontSize: size * 0.115,
              fontWeight: FontWeight.w500,
              letterSpacing: size * 0.035,
              color: labelColor.withValues(alpha: 0.7),
              height: 1.0,
            ),
          ),
        ],
      ],
    );
  }
}

class _TLogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    // Gradient from light silver (top) → mid steel → dark charcoal (bottom)
    final gradient = LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: const [
        Color(0xFFD4D4D4),
        Color(0xFFAAAAAA),
        Color(0xFF6B6B6B),
        Color(0xFF444444),
        Color(0xFF2A2A2A),
      ],
      stops: const [0.0, 0.25, 0.55, 0.80, 1.0],
    ).createShader(Rect.fromLTWH(0, 0, w, h));

    final gradPaint = Paint()..shader = gradient;

    // The "T" shape.
    // Top horizontal bar: full width, sloped inner edges to give the bevel look.
    final crossBarH = h * 0.32;
    final stemW = w * 0.34;
    final stemX = (w - stemW) / 2;
    // The cross-bar inner bottom edge is angled (trapezoid) toward the stem.
    final bevel = w * 0.06;

    final path = Path()
      // Start top-left of cross-bar
      ..moveTo(0, 0)
      // Top-right of cross-bar
      ..lineTo(w, 0)
      // Bottom-right of cross-bar (with inward bevel)
      ..lineTo(w, crossBarH)
      ..lineTo(stemX + stemW + bevel, crossBarH)
      // Angled transition into stem (right side)
      ..lineTo(stemX + stemW, crossBarH + h * 0.06)
      // Stem right side going down
      ..lineTo(stemX + stemW, h)
      // Stem left side going up
      ..lineTo(stemX, h)
      // Angled transition out of stem (left side)
      ..lineTo(stemX - bevel, crossBarH + h * 0.06)
      // Bottom-left of cross-bar (with inward bevel)
      ..lineTo(stemX - bevel, crossBarH + h * 0.06)
      ..lineTo(0, crossBarH)
      ..close();

    canvas.drawPath(path, gradPaint);

    // Subtle highlight stripe at top of the bar for the metallic sheen
    final highlightPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          Colors.white.withValues(alpha: 0.35),
          Colors.white.withValues(alpha: 0.0),
        ],
      ).createShader(Rect.fromLTWH(0, 0, w, crossBarH * 0.4))
      ..style = PaintingStyle.fill;

    final highlightPath = Path()
      ..moveTo(0, 0)
      ..lineTo(w, 0)
      ..lineTo(w, crossBarH * 0.4)
      ..lineTo(0, crossBarH * 0.4)
      ..close();
    canvas.drawPath(highlightPath, highlightPaint);

    // Fine edge line for depth (left + bottom of crossbar + right)
    final edgePaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.12)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.6;
    canvas.drawPath(path, edgePaint);
  }

  @override
  bool shouldRepaint(_TLogoPainter old) => false;
}
