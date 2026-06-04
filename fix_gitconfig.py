import subprocess, sys

# Usa subprocess para chamar git sem passar por batch/shell
repos = [
    r'C:\Users\vitor\ConnectAI-Labs\connectai-backend',
    r'C:\Users\vitor\ConnectAI-Labs\connectai-mobile',
]
for repo in repos:
    subprocess.run(['git', 'config', '--replace-all', 'user.name', 'Vitor Camillo'], cwd=repo, check=True)
    subprocess.run(['git', 'config', 'user.email', 'vitorcamilloh@gmail.com'], cwd=repo, check=True)
    name = subprocess.check_output(['git', 'config', 'user.name'], cwd=repo).decode().strip()
    email = subprocess.check_output(['git', 'config', 'user.email'], cwd=repo).decode().strip()
    print(f'{repo}: {name} <{email}>')
