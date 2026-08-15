DOCSTRING = chr(39) + chr(39) + chr(39)
exec(open('/tmp/append-templates.py').read().replace(DOCSTRING, '"""'))
