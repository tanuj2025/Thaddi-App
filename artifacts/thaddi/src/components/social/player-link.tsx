import React from 'react';
import { Link } from 'wouter';

export function PlayerLink({
  userId,
  className,
  children,
  onClick,
}: {
  userId: string;
  className?: string;
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <Link
      href={`/players/${userId}`}
      className={className}
      onClick={onClick}
      data-testid={`link-player-${userId}`}
    >
      {children}
    </Link>
  );
}
