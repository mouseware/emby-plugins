using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace Claw.Emby.Guard.Core
{
    /// <summary>
    /// Minimal MaxMind DB (.mmdb) reader, enough for GeoLite2-Country "country.iso_code"
    /// (falls back to registered_country). No third-party dependency. Spec: maxmind.github.io/MaxMind-DB.
    /// </summary>
    public sealed class MmdbReader
    {
        private static readonly byte[] MetaMarker = { 0xAB, 0xCD, 0xEF, (byte)'M', (byte)'a', (byte)'x', (byte)'M', (byte)'i', (byte)'n', (byte)'d', (byte)'.', (byte)'c', (byte)'o', (byte)'m' };
        private readonly byte[] _b;
        private readonly int _nodeCount, _recordSize, _ipVersion, _treeSize, _dataStart;
        private int _ipv4Start = -1;
        public string DatabaseType { get; }
        public DateTimeOffset BuildTime { get; }

        public MmdbReader(byte[] bytes)
        {
            _b = bytes;
            int m = LastIndexOf(bytes, MetaMarker);
            if (m < 0) throw new InvalidDataException("Not a MaxMind DB file");
            int metaStart = m + MetaMarker.Length;
            int off = metaStart;
            var meta = Decode(ref off, metaStart) as Dictionary<string, object> ?? throw new InvalidDataException("Bad metadata");
            _nodeCount = Convert.ToInt32(meta["node_count"]);
            _recordSize = Convert.ToInt32(meta["record_size"]);
            _ipVersion = Convert.ToInt32(meta["ip_version"]);
            DatabaseType = meta.TryGetValue("database_type", out var dt) ? dt as string : "";
            if (meta.TryGetValue("build_epoch", out var be)) BuildTime = DateTimeOffset.FromUnixTimeSeconds(Convert.ToInt64(be));
            if (_recordSize != 24 && _recordSize != 28 && _recordSize != 32) throw new InvalidDataException("Unsupported record size " + _recordSize);
            _treeSize = (_recordSize * 2 / 8) * _nodeCount;
            _dataStart = _treeSize + 16;
        }

        public static MmdbReader Open(string path) => new MmdbReader(File.ReadAllBytes(path));

        /// <summary>ISO country code ("GB") or null.</summary>
        public string Country(IPAddress ip)
        {
            var rec = Lookup(ip) as Dictionary<string, object>;
            if (rec == null) return null;
            foreach (var k in new[] { "country", "registered_country" })
            {
                if (rec.TryGetValue(k, out var c) && c is Dictionary<string, object> cd && cd.TryGetValue("iso_code", out var iso) && iso is string s) return s;
            }
            return null;
        }

        public object Lookup(IPAddress ip)
        {
            ip = IpUtil.Normalize(ip);
            if (ip == null) return null;
            var bytes = ip.GetAddressBytes();
            int node;
            int bitCount = bytes.Length * 8;
            if (_ipVersion == 6 && ip.AddressFamily == AddressFamily.InterNetwork) node = Ipv4Start();
            else if (_ipVersion == 4 && ip.AddressFamily == AddressFamily.InterNetworkV6) return null;
            else node = 0;
            for (int i = 0; i < bitCount && node < _nodeCount; i++)
            {
                int bit = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
                node = ReadRecord(node, bit);
            }
            if (node == _nodeCount) return null; // not found
            if (node < _nodeCount) return null;
            int ptr = node - _nodeCount - 16 + _dataStart;
            if (ptr < _dataStart || ptr >= _b.Length) return null;
            int o = ptr;
            return Decode(ref o, _dataStart);
        }

        private int Ipv4Start()
        {
            if (_ipv4Start >= 0) return _ipv4Start;
            int node = 0;
            for (int i = 0; i < 96 && node < _nodeCount; i++) node = ReadRecord(node, 0);
            return _ipv4Start = node;
        }

        private int ReadRecord(int node, int index)
        {
            int baseOff = node * _recordSize * 2 / 8;
            switch (_recordSize)
            {
                case 24:
                    {
                        int o = baseOff + index * 3;
                        return (_b[o] << 16) | (_b[o + 1] << 8) | _b[o + 2];
                    }
                case 28:
                    {
                        if (index == 0)
                            return ((_b[baseOff + 3] & 0xF0) << 20) | (_b[baseOff] << 16) | (_b[baseOff + 1] << 8) | _b[baseOff + 2];
                        return ((_b[baseOff + 3] & 0x0F) << 24) | (_b[baseOff + 4] << 16) | (_b[baseOff + 5] << 8) | _b[baseOff + 6];
                    }
                default:
                    {
                        int o = baseOff + index * 4;
                        return (int)((uint)(_b[o] << 24) | (uint)(_b[o + 1] << 16) | (uint)(_b[o + 2] << 8) | _b[o + 3]);
                    }
            }
        }

        private object Decode(ref int off, int sectionStart)
        {
            int ctrl = _b[off++];
            int type = ctrl >> 5;
            if (type == 1) // pointer
            {
                int ss = (ctrl >> 3) & 3, vvv = ctrl & 7, p;
                switch (ss)
                {
                    case 0: p = (vvv << 8) | _b[off]; off += 1; break;
                    case 1: p = ((vvv << 16) | (_b[off] << 8) | _b[off + 1]) + 2048; off += 2; break;
                    case 2: p = ((vvv << 24) | (_b[off] << 16) | (_b[off + 1] << 8) | _b[off + 2]) + 526336; off += 3; break;
                    default: p = (_b[off] << 24) | (_b[off + 1] << 16) | (_b[off + 2] << 8) | _b[off + 3]; off += 4; break;
                }
                int t = sectionStart + p;
                return Decode(ref t, sectionStart);
            }
            if (type == 0) { type = 7 + _b[off++]; } // extended
            int size = ctrl & 0x1F;
            if (size == 29) size = 29 + _b[off++];
            else if (size == 30) { size = 285 + ((_b[off] << 8) | _b[off + 1]); off += 2; }
            else if (size == 31) { size = 65821 + ((_b[off] << 16) | (_b[off + 1] << 8) | _b[off + 2]); off += 3; }
            switch (type)
            {
                case 2: { var s = Encoding.UTF8.GetString(_b, off, size); off += size; return s; }
                case 3: { var d = BitConverter.ToDouble(Rev(off, 8), 0); off += 8; return d; }
                case 4: { var a = new byte[size]; Array.Copy(_b, off, a, 0, size); off += size; return a; }
                case 5: case 6: case 9: case 10: { ulong v = 0; for (int i = 0; i < size; i++) v = (v << 8) | _b[off + i]; off += size; return (long)v; }
                case 8: { long v = 0; for (int i = 0; i < size; i++) v = (v << 8) | _b[off + i]; off += size; if (size == 4) v = (int)v; return v; }
                case 7:
                    {
                        var map = new Dictionary<string, object>(size);
                        for (int i = 0; i < size; i++) { var k = Decode(ref off, sectionStart) as string; var v = Decode(ref off, sectionStart); if (k != null) map[k] = v; }
                        return map;
                    }
                case 11:
                    {
                        var list = new List<object>(size);
                        for (int i = 0; i < size; i++) list.Add(Decode(ref off, sectionStart));
                        return list;
                    }
                case 14: return size != 0;
                case 15: { var f = BitConverter.ToSingle(Rev(off, 4), 0); off += 4; return (double)f; }
                default: off += size; return null;
            }
        }

        private byte[] Rev(int off, int n)
        {
            var a = new byte[n]; Array.Copy(_b, off, a, 0, n);
            if (BitConverter.IsLittleEndian) Array.Reverse(a);
            return a;
        }

        private static int LastIndexOf(byte[] hay, byte[] needle)
        {
            int limit = Math.Max(0, hay.Length - 128 * 1024);
            for (int i = hay.Length - needle.Length; i >= limit; i--)
            {
                int j = 0;
                while (j < needle.Length && hay[i + j] == needle[j]) j++;
                if (j == needle.Length) return i;
            }
            return -1;
        }
    }
}
