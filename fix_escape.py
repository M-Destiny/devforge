with open('src/templates.ts', 'r') as f:
    content = f.read()

# Fix the unescaped ${{ 
content = content.replace(
    'echo "SERVICE_LANGUAGE=${{ matrix.service.language }}"',
    'echo "SERVICE_LANGUAGE=\\\\${{ matrix.service.language }}"'
)
content = content.replace(
    'echo "SERVICE_PORT=${{ matrix.service.port }}"',
    'echo "SERVICE_PORT=\\\\${{ matrix.service.port }}"'
)

with open('src/templates.ts', 'w') as f:
    f.write(content)

print('Fixed escaping')