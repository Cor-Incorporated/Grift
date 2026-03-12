"""RLS-aware connection pool for multi-tenant database access."""

from __future__ import annotations

import typing
from contextlib import contextmanager
from typing import Any

import structlog

if typing.TYPE_CHECKING:
    from collections.abc import Generator
from psycopg2.pool import SimpleConnectionPool

logger = structlog.get_logger()


class RLSConnectionManager:
    """Wraps SimpleConnectionPool with per-connection RLS tenant context.

    Each connection checked out via ``get_connection`` will have the
    ``app.tenant_id`` session variable set before being yielded.  On
    release the variable is reset to prevent tenant leakage across
    pool reuse.

    Attributes:
        _pool: The underlying psycopg2 connection pool.
    """

    def __init__(self, *, dsn: str, min_conn: int = 1, max_conn: int = 5) -> None:
        """Initialise the pool.

        Args:
            dsn: PostgreSQL connection string.
            min_conn: Minimum idle connections kept in the pool.
            max_conn: Maximum connections the pool will open.
        """
        self._pool: SimpleConnectionPool = SimpleConnectionPool(
            minconn=min_conn,
            maxconn=max_conn,
            dsn=dsn,
        )
        logger.info(
            "rls_pool_created",
            min_conn=min_conn,
            max_conn=max_conn,
        )

    @contextmanager
    def get_connection(self, tenant_id: str) -> Generator[Any, None, None]:
        """Check out a connection with RLS tenant context set.

        The ``app.tenant_id`` GUC is configured at the *session* level
        (``is_local=false``) so it persists for the lifetime of the
        checkout -- even across multiple statements outside an explicit
        transaction.

        Args:
            tenant_id: The tenant identifier to bind to this connection.

        Yields:
            A psycopg2 connection with ``app.tenant_id`` configured.
        """
        conn = self._pool.getconn()
        try:
            self._set_tenant(conn, tenant_id)
            yield conn
        finally:
            self._reset_tenant(conn)
            self._pool.putconn(conn)

    def close_all(self) -> None:
        """Close every connection in the pool."""
        self._pool.closeall()
        logger.info("rls_pool_closed")

    @staticmethod
    def _set_tenant(conn: Any, tenant_id: str) -> None:
        """Set session-scoped RLS tenant variable.

        Args:
            conn: A psycopg2 connection.
            tenant_id: Tenant identifier to bind.
        """
        with conn.cursor() as cur:
            cur.execute(
                "SELECT set_config('app.tenant_id', %s, false)",
                (tenant_id,),
            )
        logger.debug("rls_tenant_set", tenant_id=tenant_id)

    @staticmethod
    def _reset_tenant(conn: Any) -> None:
        """Clear the tenant variable before returning connection to pool.

        Args:
            conn: A psycopg2 connection.
        """
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT set_config('app.tenant_id', %s, false)",
                    ("",),
                )
            logger.debug("rls_tenant_reset")
        except Exception:  # noqa: BLE001
            logger.warning("rls_tenant_reset_failed", exc_info=True)
