using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace Claw.Emby.MediaIntegrity.Core
{
    /// <summary>
    /// Minimal SQLite access through the native sqlite3 library that ships with Emby Server (system\sqlite3.dll,
    /// already loaded in-process). No extra DLLs to deploy, no dependency on Emby's internal data layer.
    /// All values are bound as parameters; nothing is ever spliced into SQL text.
    /// </summary>
    public sealed class SqliteDb : IDisposable
    {
        private const string Lib = "sqlite3";
        internal const int OK = 0, ROW = 100, DONE = 101;
        public const int OpenReadOnly = 0x1, OpenReadWrite = 0x2, OpenCreate = 0x4, OpenUri = 0x40, OpenFullMutex = 0x10000;

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int sqlite3_open_v2(byte[] filename, out IntPtr db, int flags, IntPtr vfs);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int sqlite3_close_v2(IntPtr db);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern IntPtr sqlite3_errmsg(IntPtr db);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int nByte, out IntPtr stmt, IntPtr tail);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern int sqlite3_step(IntPtr stmt);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern int sqlite3_reset(IntPtr stmt);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern int sqlite3_clear_bindings(IntPtr stmt);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern int sqlite3_finalize(IntPtr stmt);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern int sqlite3_bind_parameter_index(IntPtr stmt, byte[] name);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern int sqlite3_bind_int64(IntPtr stmt, int i, long v);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern int sqlite3_bind_double(IntPtr stmt, int i, double v);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern int sqlite3_bind_null(IntPtr stmt, int i);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern int sqlite3_bind_text(IntPtr stmt, int i, byte[] v, int n, IntPtr destructor);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern int sqlite3_column_count(IntPtr stmt);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern IntPtr sqlite3_column_name(IntPtr stmt, int i);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern int sqlite3_column_type(IntPtr stmt, int i);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern long sqlite3_column_int64(IntPtr stmt, int i);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern double sqlite3_column_double(IntPtr stmt, int i);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern IntPtr sqlite3_column_text(IntPtr stmt, int i);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] internal static extern int sqlite3_column_bytes(IntPtr stmt, int i);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern long sqlite3_last_insert_rowid(IntPtr db);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int sqlite3_changes(IntPtr db);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int sqlite3_busy_timeout(IntPtr db, int ms);

        private static readonly IntPtr Transient = new IntPtr(-1);
        private IntPtr _db;
        private readonly object _lock = new object();
        public string Path { get; }
        public object SyncRoot => _lock;

        public SqliteDb(string path, bool readOnly = false)
        {
            Path = path;
            int flags = (readOnly ? OpenReadOnly : OpenReadWrite | OpenCreate) | OpenFullMutex;
            int rc = sqlite3_open_v2(Utf8z(path), out _db, flags, IntPtr.Zero);
            if (rc != OK) { var msg = _db != IntPtr.Zero ? Msg(_db) : "rc " + rc; if (_db != IntPtr.Zero) sqlite3_close_v2(_db); _db = IntPtr.Zero; throw new SqliteException("open " + path + ": " + msg, rc); }
            sqlite3_busy_timeout(_db, 10000);
        }

        internal static byte[] Utf8z(string s) { var b = Encoding.UTF8.GetBytes(s ?? ""); Array.Resize(ref b, b.Length + 1); return b; }
        internal static string Msg(IntPtr db) => Marshal.PtrToStringUTF8(sqlite3_errmsg(db)) ?? "";
        internal string Err() => Msg(_db);

        public long LastInsertId { get { lock (_lock) return sqlite3_last_insert_rowid(_db); } }
        public int Changes { get { lock (_lock) return sqlite3_changes(_db); } }

        public Stmt Prepare(string sql)
        {
            if (_db == IntPtr.Zero) throw new ObjectDisposedException("SqliteDb");
            var b = Utf8z(sql);
            int rc = sqlite3_prepare_v2(_db, b, b.Length, out var st, IntPtr.Zero);
            if (rc != OK) throw new SqliteException("prepare: " + Err() + " in: " + sql, rc);
            return new Stmt(this, st);
        }

        /// <summary>Run one statement with named parameters (@name), return rows changed.</summary>
        public int Exec(string sql, params (string, object)[] args)
        {
            lock (_lock) { using (var s = Prepare(sql)) { s.Bind(args); s.StepDone(); return sqlite3_changes(_db); } }
        }

        /// <summary>Run several ';'-separated statements without parameters (schema scripts).</summary>
        public void ExecScript(string sql)
        {
            foreach (var part in sql.Split(';'))
            {
                var p = part.Trim();
                if (p.Length > 0) Exec(p);
            }
        }

        public List<Row> Query(string sql, params (string, object)[] args)
        {
            lock (_lock)
            {
                var list = new List<Row>();
                using (var s = Prepare(sql)) { s.Bind(args); while (s.Step()) list.Add(s.Row()); }
                return list;
            }
        }

        public object Scalar(string sql, params (string, object)[] args)
        {
            lock (_lock)
            {
                using (var s = Prepare(sql)) { s.Bind(args); return s.Step() ? s.Value(0) : null; }
            }
        }
        public long ScalarLong(string sql, params (string, object)[] args) { var v = Scalar(sql, args); return v == null ? 0 : Convert.ToInt64(v); }

        /// <summary>Runs <paramref name="body"/> inside BEGIN IMMEDIATE / COMMIT (rolls back on exception).</summary>
        public void Transaction(Action body)
        {
            lock (_lock)
            {
                Exec("BEGIN IMMEDIATE");
                try { body(); Exec("COMMIT"); }
                catch { try { Exec("ROLLBACK"); } catch { } throw; }
            }
        }

        public void Dispose()
        {
            lock (_lock) { if (_db != IntPtr.Zero) { sqlite3_close_v2(_db); _db = IntPtr.Zero; } }
        }
    }

    public sealed class SqliteException : Exception { public int Code { get; } public SqliteException(string m, int code) : base(m) { Code = code; } }

    /// <summary>One result row: column name -> value (long, double, string or null).</summary>
    public sealed class Row : Dictionary<string, object>
    {
        public Row() : base(StringComparer.OrdinalIgnoreCase) { }
        public string Str(string c) => TryGetValue(c, out var v) && v != null ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) : null;
        public long Long(string c) => TryGetValue(c, out var v) && v != null ? Convert.ToInt64(v, System.Globalization.CultureInfo.InvariantCulture) : 0;
        public long? LongN(string c) => TryGetValue(c, out var v) && v != null ? Convert.ToInt64(v, System.Globalization.CultureInfo.InvariantCulture) : (long?)null;
        public double Dbl(string c) => TryGetValue(c, out var v) && v != null ? Convert.ToDouble(v, System.Globalization.CultureInfo.InvariantCulture) : 0;
    }

    public sealed class Stmt : IDisposable
    {
        private readonly SqliteDb _db;
        private IntPtr _st;
        internal Stmt(SqliteDb db, IntPtr st) { _db = db; _st = st; }

        public void Bind(params (string, object)[] args)
        {
            SqliteDb.sqlite3_reset(_st); SqliteDb.sqlite3_clear_bindings(_st);
            if (args == null) return;
            foreach (var (name, val) in args)
            {
                int i = SqliteDb.sqlite3_bind_parameter_index(_st, SqliteDb.Utf8z(name.StartsWith("@") ? name : "@" + name));
                if (i == 0) continue; // parameter not used by this statement
                int rc;
                switch (val)
                {
                    case null: rc = SqliteDb.sqlite3_bind_null(_st, i); break;
                    case bool b: rc = SqliteDb.sqlite3_bind_int64(_st, i, b ? 1 : 0); break;
                    case int n: rc = SqliteDb.sqlite3_bind_int64(_st, i, n); break;
                    case long l: rc = SqliteDb.sqlite3_bind_int64(_st, i, l); break;
                    case double d: rc = SqliteDb.sqlite3_bind_double(_st, i, d); break;
                    case DateTime dt: rc = BindText(i, Time.ToDb(dt)); break;
                    case DateTimeOffset dto: rc = BindText(i, Time.ToDb(dto.UtcDateTime)); break;
                    default: rc = BindText(i, Convert.ToString(val, System.Globalization.CultureInfo.InvariantCulture)); break;
                }
                if (rc != SqliteDb.OK) throw new SqliteException("bind " + name + ": " + _db.Err(), rc);
            }
        }
        private int BindText(int i, string s) { var b = Encoding.UTF8.GetBytes(s); return SqliteDb.sqlite3_bind_text(_st, i, b, b.Length, new IntPtr(-1)); }

        public bool Step()
        {
            int rc = SqliteDb.sqlite3_step(_st);
            if (rc == SqliteDb.ROW) return true;
            if (rc == SqliteDb.DONE) return false;
            throw new SqliteException("step: " + _db.Err(), rc);
        }
        public void StepDone() { while (Step()) { } }

        public object Value(int i)
        {
            switch (SqliteDb.sqlite3_column_type(_st, i))
            {
                case 1: return SqliteDb.sqlite3_column_int64(_st, i);
                case 2: return SqliteDb.sqlite3_column_double(_st, i);
                case 5: return null;
                default:
                    var p = SqliteDb.sqlite3_column_text(_st, i); int n = SqliteDb.sqlite3_column_bytes(_st, i);
                    if (p == IntPtr.Zero) return null;
                    var buf = new byte[n]; Marshal.Copy(p, buf, 0, n); return Encoding.UTF8.GetString(buf);
            }
        }
        public Row Row()
        {
            var r = new Row(); int n = SqliteDb.sqlite3_column_count(_st);
            for (int i = 0; i < n; i++) r[Marshal.PtrToStringUTF8(SqliteDb.sqlite3_column_name(_st, i))] = Value(i);
            return r;
        }
        public void Dispose() { if (_st != IntPtr.Zero) { SqliteDb.sqlite3_finalize(_st); _st = IntPtr.Zero; } }
    }

    public static class Time
    {
        /// <summary>All times are stored as UTC "yyyy-MM-ddTHH:mm:ssZ" text (sortable, unambiguous).</summary>
        public static string ToDb(DateTime t) => (t.Kind == DateTimeKind.Local ? t.ToUniversalTime() : t).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", System.Globalization.CultureInfo.InvariantCulture);
        public static DateTime? FromDb(string s)
        {
            if (string.IsNullOrEmpty(s)) return null;
            if (DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var d)) return DateTime.SpecifyKind(d, DateTimeKind.Utc);
            return null;
        }
    }
}
