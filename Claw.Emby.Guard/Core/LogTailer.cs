using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Claw.Emby.Guard.Core
{
    /// <summary>
    /// Follows embyserver.txt. Starts at the END (no replay of old lines), reads only complete lines,
    /// survives Emby's rotation (file renamed to embyserver-NNN.txt and a new embyserver.txt created)
    /// and truncation. Opens with FileShare.ReadWrite|Delete so Emby is never blocked.
    /// </summary>
    public class LogTailer
    {
        private readonly string _path;
        private long _pos = -1;
        private DateTime _created;
        private readonly StringBuilder _partial = new StringBuilder();

        public LogTailer(string path) { _path = path; }
        public string Path => _path;

        public List<string> Poll(int maxBytes = 4 * 1024 * 1024)
        {
            var lines = new List<string>();
            if (!File.Exists(_path)) { _pos = 0; _partial.Clear(); return lines; }
            var fi = new FileInfo(_path);
            var created = fi.CreationTimeUtc;
            if (_pos < 0) { _pos = fi.Length; _created = created; return lines; } // first poll: start at end
            if (fi.Length < _pos || created != _created) { _pos = 0; _partial.Clear(); _created = created; } // rotated / truncated
            if (fi.Length == _pos) return lines;
            using (var fs = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                fs.Seek(_pos, SeekOrigin.Begin);
                var toRead = (int)Math.Min(maxBytes, fs.Length - _pos);
                var buf = new byte[toRead];
                int read = 0;
                while (read < toRead) { var n = fs.Read(buf, read, toRead - read); if (n <= 0) break; read += n; }
                // only consume up to the last newline (UTF-8 safe: '\n' never appears inside a multibyte char)
                int last = Array.LastIndexOf(buf, (byte)'\n', read - 1 < 0 ? 0 : read - 1);
                if (last < 0)
                {
                    if (read >= maxBytes) { _pos += read; } // giant line: skip
                    return lines;
                }
                var text = Encoding.UTF8.GetString(buf, 0, last + 1);
                _pos += last + 1;
                foreach (var l in text.Split('\n'))
                {
                    var t = l.TrimEnd('\r');
                    if (t.Length > 0) lines.Add(t);
                }
            }
            return lines;
        }
    }
}
