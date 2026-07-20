#include <process.h>
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
    const char *ld = getenv("VITA_LD");
    if (!ld || !*ld) ld = "C:/msys64/usr/local/vitasdk/bin/arm-vita-eabi-ld.exe";

    char **args = (char **)calloc((size_t)argc + 1, sizeof(char *));
    if (!args) return 111;
    args[0] = (char *)ld;
    for (int i = 1; i < argc; ++i) args[i] = argv[i];
    args[argc] = NULL;

    int rc = _spawnv(_P_WAIT, ld, (const char * const *)args);
    if (rc == -1) perror("collect2 shim");
    free(args);
    return rc;
}
