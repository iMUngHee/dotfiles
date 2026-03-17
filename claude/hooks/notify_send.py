import json, socket, sys

d = json.dumps({
    'title': sys.argv[1],
    'body':  sys.argv[2],
    'sound': sys.argv[3],
    'tag':   sys.argv[4],
})
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(2)
s.connect('/tmp/claude-notifier.sock')
s.sendall(d.encode())
s.close()
