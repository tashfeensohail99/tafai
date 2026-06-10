import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/auth/auth_controller.dart';
import '../../../../core/errors/app_error.dart';
import '../../../../core/router/app_router.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../core/widgets/app_states.dart';
import '../../../../core/widgets/logo.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();

  bool _obscurePassword = true;
  bool _loading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      await ref.read(authControllerProvider.notifier).login(
            email: _emailController.text.trim(),
            password: _passwordController.text,
          );
      // Navigation is handled by the router redirect on auth-state change.
    } on AppError catch (e) {
      setState(() => _errorMessage = _friendly(e));
    } catch (_) {
      setState(() => _errorMessage = 'Something went wrong. Please try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _friendly(AppError e) => switch (e) {
        UnauthorizedError() => 'Invalid email or password.',
        ServerError(statusCode: 423) =>
          'Account locked after too many attempts. Try again in 15 minutes.',
        ServerError(statusCode: 429) =>
          'Too many attempts. Please wait a moment and try again.',
        NetworkError(:final message) => message,
        ServerError(:final message) => message,
        _ => 'Something went wrong. Please try again.',
      };

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: AppTokens.brandNavy,
        body: Column(
          children: [
            // ── Brand navy hero: logo ──────────────────────────────────────
            SafeArea(
              bottom: false,
              child: SizedBox(
                height: 220,
                child: const Center(
                  child: TashfeenLogo(
                    size: 80,
                    showText: true,
                    textColor: AppTokens.brandSilverText,
                  ),
                ),
              ),
            ),

            // ── White card: sign-in form ───────────────────────────────────
            Expanded(
              child: Container(
                decoration: const BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
                ),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(
                    AppTokens.space6,
                    AppTokens.space8,
                    AppTokens.space6,
                    AppTokens.space6,
                  ),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 420),
                    child: Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            'Sign in to your account',
                            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                  color: AppTokens.textPrimaryLight,
                                  fontWeight: FontWeight.w700,
                                ),
                          ),
                          const SizedBox(height: AppTokens.space6),

                          if (_errorMessage != null) ...[
                            ErrorBanner(_errorMessage!),
                            const SizedBox(height: AppTokens.space4),
                          ],

                          TextFormField(
                            controller: _emailController,
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            autocorrect: false,
                            decoration: const InputDecoration(
                              labelText: 'Email address',
                              prefixIcon: Icon(Icons.email_outlined, size: 20),
                            ),
                            validator: (v) {
                              if (v == null || v.trim().isEmpty) {
                                return 'Email is required';
                              }
                              if (!v.contains('@')) return 'Enter a valid email';
                              return null;
                            },
                          ),
                          const SizedBox(height: AppTokens.space4),

                          TextFormField(
                            controller: _passwordController,
                            obscureText: _obscurePassword,
                            textInputAction: TextInputAction.done,
                            onFieldSubmitted: (_) => _submit(),
                            decoration: InputDecoration(
                              labelText: 'Password',
                              prefixIcon: const Icon(Icons.lock_outlined, size: 20),
                              suffixIcon: IconButton(
                                icon: Icon(
                                  _obscurePassword
                                      ? Icons.visibility_outlined
                                      : Icons.visibility_off_outlined,
                                  size: 20,
                                ),
                                onPressed: () => setState(
                                    () => _obscurePassword = !_obscurePassword),
                              ),
                            ),
                            validator: (v) {
                              if (v == null || v.isEmpty) return 'Password is required';
                              return null;
                            },
                          ),
                          const SizedBox(height: AppTokens.space6),

                          ElevatedButton(
                            onPressed: _loading ? null : _submit,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppTokens.brandNavy,
                              foregroundColor: Colors.white,
                              disabledBackgroundColor:
                                  AppTokens.brandNavy.withValues(alpha: 0.5),
                            ),
                            child: _loading
                                ? const ButtonSpinner()
                                : const Text('Sign in'),
                          ),
                          const SizedBox(height: AppTokens.space2),

                          TextButton(
                            onPressed: _loading
                                ? null
                                : () => context.push(AppRoutes.forgotPassword),
                            child: const Text('Forgot password?'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
