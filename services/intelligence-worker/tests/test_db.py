"""Tests for intelligence_worker.db RLS-aware connection pooling."""

from __future__ import annotations

from unittest.mock import MagicMock, call, patch

import pytest

from intelligence_worker.db import RLSConnectionManager


@pytest.fixture()
def mock_pool() -> MagicMock:
    """Return a mock SimpleConnectionPool."""
    return MagicMock()


@pytest.fixture()
def manager(mock_pool: MagicMock) -> RLSConnectionManager:
    """Return an RLSConnectionManager with a pre-injected mock pool."""
    with patch(
        "intelligence_worker.db.SimpleConnectionPool",
        return_value=mock_pool,
    ):
        mgr = RLSConnectionManager(dsn="postgresql://localhost/test")
    return mgr


class TestGetConnection:
    """Tests for RLSConnectionManager.get_connection."""

    def test_sets_tenant_id_via_set_config(
        self, manager: RLSConnectionManager, mock_pool: MagicMock
    ) -> None:
        """set_config is called with the correct tenant_id parameter."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_pool.getconn.return_value = mock_conn

        with manager.get_connection("tenant-abc") as conn:
            assert conn is mock_conn

        # First call sets tenant, second call resets tenant
        set_calls = mock_cursor.execute.call_args_list
        assert len(set_calls) == 2

        # Verify set_config with tenant_id
        assert set_calls[0] == call(
            "SELECT set_config('app.tenant_id', %s, false)",
            ("tenant-abc",),
        )
        # Verify reset with empty string
        assert set_calls[1] == call(
            "SELECT set_config('app.tenant_id', %s, false)",
            ("",),
        )

    def test_returns_connection_to_pool_on_success(
        self, manager: RLSConnectionManager, mock_pool: MagicMock
    ) -> None:
        """Connection is returned to pool via putconn after normal use."""
        mock_conn = MagicMock()
        mock_pool.getconn.return_value = mock_conn

        with manager.get_connection("tenant-1"):
            pass

        mock_pool.putconn.assert_called_once_with(mock_conn)

    def test_returns_connection_to_pool_on_exception(
        self, manager: RLSConnectionManager, mock_pool: MagicMock
    ) -> None:
        """Connection is returned to pool even when body raises."""
        mock_conn = MagicMock()
        mock_pool.getconn.return_value = mock_conn

        with (
            pytest.raises(RuntimeError, match="boom"),
            manager.get_connection("tenant-2"),
        ):
            raise RuntimeError("boom")

        mock_pool.putconn.assert_called_once_with(mock_conn)

    def test_uses_parameterized_query_not_string_format(
        self, manager: RLSConnectionManager, mock_pool: MagicMock
    ) -> None:
        """SQL injection prevention: tenant_id is passed as parameter."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_pool.getconn.return_value = mock_conn

        malicious = "'; DROP TABLE users; --"
        with manager.get_connection(malicious):
            pass

        set_call = mock_cursor.execute.call_args_list[0]
        # The SQL template must NOT contain the tenant value inline
        sql_template = set_call[0][0]
        assert malicious not in sql_template
        # The tenant value is in the parameter tuple
        assert set_call[0][1] == (malicious,)

    def test_session_scoped_not_transaction_scoped(
        self, manager: RLSConnectionManager, mock_pool: MagicMock
    ) -> None:
        """set_config uses false (session-scoped), not true (transaction-scoped)."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_pool.getconn.return_value = mock_conn

        with manager.get_connection("t1"):
            pass

        sql = mock_cursor.execute.call_args_list[0][0][0]
        assert "false" in sql


class TestCloseAll:
    """Tests for RLSConnectionManager.close_all."""

    def test_delegates_to_pool_closeall(
        self, manager: RLSConnectionManager, mock_pool: MagicMock
    ) -> None:
        """close_all delegates to the underlying pool."""
        manager.close_all()
        mock_pool.closeall.assert_called_once()


class TestPoolConfiguration:
    """Tests for pool min/max configuration."""

    def test_passes_min_max_to_pool(self) -> None:
        """min_conn and max_conn are forwarded to SimpleConnectionPool."""
        with patch("intelligence_worker.db.SimpleConnectionPool") as mock_pool_cls:
            RLSConnectionManager(dsn="postgresql://x/db", min_conn=3, max_conn=10)

        mock_pool_cls.assert_called_once_with(
            minconn=3,
            maxconn=10,
            dsn="postgresql://x/db",
        )

    def test_default_min_max(self) -> None:
        """Default pool sizes are 1 and 5."""
        with patch("intelligence_worker.db.SimpleConnectionPool") as mock_pool_cls:
            RLSConnectionManager(dsn="postgresql://x/db")

        mock_pool_cls.assert_called_once_with(
            minconn=1,
            maxconn=5,
            dsn="postgresql://x/db",
        )
