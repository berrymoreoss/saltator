/* The program in the RAM of soc.v from address 0: code and constants, data, then .bss (cleared
   by start.S). The stack takes the RAM's top, below 0x1000. */
MEMORY {
  ram (rwx) : ORIGIN = 0x00000000, LENGTH = 4K
}

ENTRY(_start)

SECTIONS {
  .text : {
    *(.text.start)
    *(.text .text.*)
    *(.rodata .rodata.* .srodata .srodata.*)
  } > ram
  .data : {
    *(.data .data.* .sdata .sdata.*)
  } > ram
  .bss (NOLOAD) : ALIGN(4) {
    __bss_start = .;
    *(.bss .bss.* .sbss .sbss.* COMMON)
    . = ALIGN(4);
    __bss_end = .;
  } > ram
}
