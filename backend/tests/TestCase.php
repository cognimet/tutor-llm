<?php

namespace Tests;

use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    /** The only database the suite is ever allowed to touch. */
    private const TEST_DATABASE = 'aitutor_test';

    /** A table from the newest migration — proves the test schema is current. */
    private const SENTINEL_TABLE = 'topic_prerequisites';

    /** Traits that drop and recreate tables. Banned outright — see below. */
    private const REFRESHING_TRAITS = [
        RefreshDatabase::class,
        LazilyRefreshDatabase::class,
        DatabaseMigrations::class,
    ];

    /**
     * Two independent safeguards keep the suite away from real data.
     *
     * 1. The connection is pinned to a dedicated database here, and we refuse to
     *    run if it resolves to anything else. `phpunit.xml`'s `<env>` is NOT enough
     *    on its own: docker-compose.yml exports DB_DATABASE into the container, and
     *    that value wins over the XML even with `force="true"`.
     *
     * 2. No test ever refreshes the database. Tests use `DatabaseTransactions`
     *    (roll back), never `RefreshDatabase` (which runs `migrate:fresh` and drops
     *    every table). So even if safeguard 1 were defeated, a run cannot destroy
     *    data — it can only fail to commit.
     *
     * This hook is the right one: `setUp()` calls `refreshApplication()` and only
     * then `setUpTraits()`, where the transaction is opened — so the connection is
     * already pinned before anything touches the database.
     */
    protected function refreshApplication(): void
    {
        parent::refreshApplication();

        $this->assertDoesNotRefreshTheDatabase();

        $connection = config('database.default');
        config(["database.connections.{$connection}.database" => self::TEST_DATABASE]);
        DB::purge($connection);

        $actual = DB::connection()->getDatabaseName();
        if ($actual !== self::TEST_DATABASE) {
            throw new RuntimeException(
                "Refusing to run tests against '{$actual}'. Expected '" . self::TEST_DATABASE . "'.",
            );
        }

        // The suite never migrates, so the schema has to be there already.
        if (! Schema::hasTable(self::SENTINEL_TABLE)) {
            throw new RuntimeException(
                'The test database is missing or out of date. Set it up with:' . PHP_EOL
                . '  docker compose exec postgres createdb -U aitutor ' . self::TEST_DATABASE . PHP_EOL
                . '  docker compose exec -e DB_DATABASE=' . self::TEST_DATABASE . ' backend php artisan migrate --force',
            );
        }
    }

    /**
     * Enforce safeguard 2 rather than merely documenting it.
     *
     * A comment saying "use DatabaseTransactions" is a convention someone will
     * eventually break by pasting `use RefreshDatabase;` out of habit. This turns
     * that into a loud failure on the very first test, before any table is dropped.
     */
    private function assertDoesNotRefreshTheDatabase(): void
    {
        $used = class_uses_recursive(static::class);

        foreach (self::REFRESHING_TRAITS as $banned) {
            if (isset($used[$banned])) {
                throw new RuntimeException(
                    static::class . ' uses ' . class_basename($banned) . ', which drops every table. '
                    . 'Use Illuminate\Foundation\Testing\DatabaseTransactions instead — '
                    . 'this suite never refreshes the database.',
                );
            }
        }
    }
}
