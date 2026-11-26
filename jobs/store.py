"""Where the jobs keep their files: Cloudflare R2 (through its S3 interface) or a local folder for tests.

Every write goes through `put`, which counts it: the jobs stop before they use more than their share
of R2's free writes (1M per month; the intake Worker has its own share).
"""
import gzip
import json
import os
from pathlib import Path


class WriteCapReached(Exception):
    pass


class Store:
    def __init__(self, max_writes):
        self.max_writes = max_writes
        self.writes = 0

    def _count(self):
        if self.writes >= self.max_writes:
            raise WriteCapReached(f"stopped after {self.writes} writes (cap for one run)")
        self.writes += 1

    # json helpers (plain or gzipped, decided by the name)
    def get_json(self, key):
        raw = self.get(key)
        if raw is None:
            return None
        if key.endswith(".gz"):
            raw = gzip.decompress(raw)
        return json.loads(raw)

    def put_json(self, key, value):
        raw = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        if key.endswith(".gz"):
            raw = gzip.compress(raw)
        self.put(key, raw)


class LocalStore(Store):
    def __init__(self, root, max_writes=10_000):
        super().__init__(max_writes)
        self.root = Path(root)

    def list(self, prefix):
        base = self.root
        out = []
        if not base.exists():
            return out
        for p in base.rglob("*"):
            if p.is_file():
                k = p.relative_to(base).as_posix()
                if k.startswith(prefix):
                    out.append(k)
        return sorted(out)

    def list_meta(self, prefix):
        """[(key, last modified as unix seconds)]"""
        return [(k, (self.root / k).stat().st_mtime) for k in self.list(prefix)]

    def get(self, key):
        p = self.root / key
        return p.read_bytes() if p.exists() else None

    def put(self, key, data):
        self._count()
        p = self.root / key
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def delete(self, keys):
        for k in keys:
            (self.root / k).unlink(missing_ok=True)


class R2Store(Store):
    """R2 through boto3. Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (GitHub secrets)."""

    def __init__(self, bucket, max_writes):
        super().__init__(max_writes)
        import boto3  # only in the GitHub job

        self.bucket = bucket
        self.s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )

    def list(self, prefix):
        return [k for k, _ in self.list_meta(prefix)]

    def list_meta(self, prefix):
        """[(key, last modified as unix seconds)]"""
        out, token = [], None
        while True:
            kw = {"Bucket": self.bucket, "Prefix": prefix}
            if token:
                kw["ContinuationToken"] = token
            r = self.s3.list_objects_v2(**kw)
            out += [(o["Key"], o["LastModified"].timestamp()) for o in r.get("Contents", [])]
            if not r.get("IsTruncated"):
                return sorted(out)
            token = r["NextContinuationToken"]

    def get(self, key):
        try:
            return self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except self.s3.exceptions.NoSuchKey:
            return None

    def put(self, key, data):
        self._count()
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data)

    def delete(self, keys):
        keys = list(keys)
        for i in range(0, len(keys), 1000):
            chunk = [{"Key": k} for k in keys[i:i + 1000]]
            self.s3.delete_objects(Bucket=self.bucket, Delete={"Objects": chunk})
