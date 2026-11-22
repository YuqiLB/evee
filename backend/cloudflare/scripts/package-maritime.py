"""Build the deployment archive from an explicit allowlist; never include .env."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[2]
target = root / 'maritime-deploy.zip'
names = ('Dockerfile', 'requirements.txt', 'main.py', 'start.py', '.dockerignore')
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for name in names:
        archive.write(root / 'maritime' / name, name)
print(f'Maritime deployment archive created: {target}')
print('Contains only application source and dependencies. No credentials included.')
