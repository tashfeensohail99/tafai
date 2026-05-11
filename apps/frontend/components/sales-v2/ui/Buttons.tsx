'use client';

import Link from 'next/link';
import type { Route } from 'next';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonSize = 'sm' | 'md' | 'lg';
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warm';

interface BaseProps {
  size?: ButtonSize;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
  children: ReactNode;
}

interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>,
    BaseProps {
  variant: ButtonVariant;
}

interface LinkButtonProps extends BaseProps {
  href: string | Route;
  variant: ButtonVariant;
  className?: string;
  ariaLabel?: string;
}

function classFor(variant: ButtonVariant, size: ButtonSize, full?: boolean) {
  const sizeClass = size === 'sm' ? 'sos-btn--sm' : size === 'lg' ? 'sos-btn--lg' : '';
  const variantClass = `sos-btn--${variant}`;
  return ['sos-btn', variantClass, sizeClass, full ? 'sos-btn--full' : '']
    .filter(Boolean)
    .join(' ');
}

/** Premium primary call-to-action button. */
export function PrimaryButton({
  children,
  iconLeft,
  iconRight,
  size = 'md',
  fullWidth,
  className = '',
  ...rest
}: Omit<ButtonProps, 'variant'>) {
  return (
    <button
      className={`${classFor('primary', size, fullWidth)} ${className}`}
      style={fullWidth ? { width: '100%' } : undefined}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}

/** Secondary glass button. */
export function SecondaryButton({
  children,
  iconLeft,
  iconRight,
  size = 'md',
  fullWidth,
  className = '',
  ...rest
}: Omit<ButtonProps, 'variant'>) {
  return (
    <button
      className={`${classFor('secondary', size, fullWidth)} ${className}`}
      style={fullWidth ? { width: '100%' } : undefined}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}

/** Ghost button (low-emphasis text-style). */
export function GhostButton({
  children,
  iconLeft,
  iconRight,
  size = 'md',
  fullWidth,
  className = '',
  ...rest
}: Omit<ButtonProps, 'variant'>) {
  return (
    <button
      className={`${classFor('ghost', size, fullWidth)} ${className}`}
      style={fullWidth ? { width: '100%' } : undefined}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}

export function DangerButton(props: Omit<ButtonProps, 'variant'>) {
  const { children, iconLeft, iconRight, size = 'md', fullWidth, className = '', ...rest } = props;
  return (
    <button
      className={`${classFor('danger', size, fullWidth)} ${className}`}
      style={fullWidth ? { width: '100%' } : undefined}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}

export function SuccessButton(props: Omit<ButtonProps, 'variant'>) {
  const { children, iconLeft, iconRight, size = 'md', fullWidth, className = '', ...rest } = props;
  return (
    <button
      className={`${classFor('success', size, fullWidth)} ${className}`}
      style={fullWidth ? { width: '100%' } : undefined}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}

/** Link styled as a primary/secondary/ghost button. */
export function ButtonLink({
  href,
  variant,
  size = 'md',
  iconLeft,
  iconRight,
  fullWidth,
  className = '',
  ariaLabel,
  children,
}: LinkButtonProps) {
  return (
    <Link
      href={href as Route}
      aria-label={ariaLabel}
      className={`${classFor(variant, size, fullWidth)} ${className}`}
      style={fullWidth ? { width: '100%' } : undefined}
    >
      {iconLeft}
      {children}
      {iconRight}
    </Link>
  );
}
